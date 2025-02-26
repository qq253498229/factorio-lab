import { Injectable } from '@angular/core';
import { Event, NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { deflate, inflate } from 'pako';
import { Observable } from 'rxjs';
import { filter, first, map } from 'rxjs/operators';

import { data } from 'src/data';
import {
  DisplayRate,
  Entities,
  FactorySettings,
  ItemSettings,
  ModHash,
  Preset,
  Product,
  RateType,
  Rational,
  RecipeSettings,
  Step,
} from '~/models';
import { LabState } from '~/store';
import * as App from '~/store/app.actions';
import * as Datasets from '~/store/datasets';
import * as Factories from '~/store/factories';
import * as Items from '~/store/items';
import * as Products from '~/store/products';
import * as Recipes from '~/store/recipes';
import * as Settings from '~/store/settings';

export const NULL = '?'; // Encoded, previously 'n'
export const EMPTY = '='; // Encoded, previously 'e'
export const LISTSEP = '_'; // Unreserved, previously ','
export const ARRAYSEP = '~'; // Unreserved, previously '+'
export const FIELDSEP = '*'; // Reserved, unescaped by encoding
export const TRUE = '1';
export const FALSE = '0';
export const BASE64ABC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.'; // Unreserved
export const MAX = BASE64ABC.length;
export const INVERT = BASE64ABC.split('').reduce(
  (e: Entities<number>, c, i) => {
    e[c] = i;
    return e;
  },
  {}
);
export const MIN_ZIP = 75;

export enum Section {
  Version = 'v',
  Base = 'b',
  Products = 'p',
  Items = 'i',
  Recipes = 'r',
  Factories = 'f',
  Settings = 's',
}

export enum ZipVersion {
  Version0 = '0',
  Version1 = '1',
  Version2 = '2',
  Version3 = '3',
}

export interface Zip {
  bare: string;
  hash: string;
}

@Injectable({
  providedIn: 'root',
})
export class RouterService {
  zip: string | undefined;
  zipPartial: Zip = { bare: '', hash: '' };
  base64codes: Uint8Array;
  // Intended to denote hashing algorithm version
  bareVersion = ZipVersion.Version1;
  hashVersion = ZipVersion.Version3;
  zipTail: Zip = {
    bare: `&${Section.Version}=${this.bareVersion}`,
    hash: `&${Section.Version}${this.hashVersion}`,
  };
  first = true;

  constructor(private router: Router, private store: Store<LabState>) {
    const l = 256;
    this.base64codes = new Uint8Array(l);
    for (let i = 0; i < l; i++) {
      this.base64codes[i] = 255; // invalid character
    }
    for (let i = 0; i < BASE64ABC.length; i++) {
      this.base64codes[BASE64ABC.charCodeAt(i)] = i;
    }
    this.base64codes['_'.charCodeAt(0)] = 0;

    this.router.events.subscribe((e) => this.updateState(e));

    this.store.select(Products.getZipState).subscribe((s) => {
      let skip = false;
      if (this.first) {
        // First update: if there are no modified settings, leave base URL.
        if (
          Object.keys(s.items).length === 0 &&
          Object.keys(s.recipes).length === 0 &&
          JSON.stringify(s.factories) ===
            JSON.stringify(Factories.initialFactoriesState) &&
          JSON.stringify(s.settings) ===
            JSON.stringify(Settings.initialSettingsState)
        ) {
          // No modified settings, skip first update.
          skip = true;
        }
        // Don't check again later, always update.
        this.first = false;
      }
      if (!skip) {
        this.updateUrl(s.products, s.items, s.recipes, s.factories, s.settings);
      }
    });
  }

  updateUrl(
    products: Products.ProductsState,
    items: Items.ItemsState,
    recipes: Recipes.RecipesState,
    factories: Factories.FactoriesState,
    settings: Settings.SettingsState
  ): void {
    this.zipState(products, items, recipes, factories, settings).subscribe(
      (zState) => {
        this.zip = this.getHash(zState);
        const hash = this.router.url.split('#');
        this.router.navigateByUrl(
          `${hash[0].split('?')[0]}?${this.zip}${
            (hash[1] && `#${hash[1]}`) || ''
          }`
        );
      }
    );
  }

  zipState(
    products: Products.ProductsState,
    items: Items.ItemsState,
    recipes: Recipes.RecipesState,
    factories: Factories.FactoriesState,
    settings: Settings.SettingsState
  ): Observable<Zip> {
    return this.store.select(Datasets.getHashEntities).pipe(
      map((hashEntities) => hashEntities[settings.baseId]),
      filter((hash): hash is ModHash => hash != null),
      first(),
      map((hash) => {
        const zipPartial: Zip = { bare: '', hash: '' };
        // Base
        const zBase = this.zipDiffString(
          settings.baseId,
          Settings.initialSettingsState.baseId
        );
        if (zBase.length) {
          zipPartial.hash += `&${Section.Base}${this.getId(
            data.hash.indexOf(zBase)
          )}`;
        }
        // Products
        const p = products.ids.map((i) => products.entities[i]);
        const zState = this.zipProducts(p, hash);
        // Settings
        this.zipItems(zipPartial, items, hash);
        this.zipRecipes(zipPartial, recipes, hash);
        this.zipFactories(zipPartial, factories, hash);
        this.zipSettings(zipPartial, settings, hash);
        this.zipPartial = zipPartial;
        return zState;
      })
    );
  }

  stepHref(step: Step, hash: ModHash | undefined): string | null {
    if (step.items == null || step.itemId == null || hash == null) {
      return null;
    }
    const products: Product[] = [
      {
        id: '0',
        itemId: step.itemId,
        rate: step.items.toString(),
        rateType: RateType.Items,
      },
    ];
    return '?' + this.getHash(this.zipProducts(products, hash));
  }

  getHash(zProducts: Zip): string {
    const bare = zProducts.bare + this.zipPartial.bare + this.zipTail.bare;
    const hash = zProducts.hash + this.zipPartial.hash + this.zipTail.hash;
    const zip = `z=${this.bytesToBase64(deflate(hash))}`;
    return bare.length < Math.max(zip.length, MIN_ZIP) ? bare : zip;
  }

  getParams(zip: string): Entities {
    const sections = zip.split('&');
    const substr = sections[0][1] === '=' ? 2 : 1;
    const params = sections.reduce((e: Entities<string>, v) => {
      e[v[0]] = v.substring(substr);
      return e;
    }, {});
    return params;
  }

  updateState(e: Event): void {
    try {
      if (e instanceof NavigationEnd) {
        const [prehash, ...posthash] = e.urlAfterRedirects.split('#');
        const hash = posthash.join('#'); // Preserve # after first instance
        const [prequery, ...postquery] = prehash.split('?');
        let query = postquery.join('?'); // Preserve ? after first instance
        if (!query.length && hash.length > 1 && hash[1] === '=') {
          // Try to recognize and handle old hash style navigation
          query = hash;
        }
        if (query) {
          let zip = query;
          if (this.zip !== zip) {
            if (zip.startsWith('z=')) {
              // Upgrade old query-unsafe zipped characters
              const z = zip
                .substring(2)
                .replace(/\+/g, '-')
                .replace(/\//g, '.')
                .replace(/=/g, '_');
              zip = this.inflateSafe(z);
            }
            // Upgrade old query-unsafe delimiters
            zip = zip.replace(/,/g, LISTSEP).replace(/\+/g, ARRAYSEP);
            // Upgrade old null/empty values
            zip = zip
              .replace(/\*n\*/g, `*${NULL}*`)
              .replace(/\*e\*/g, `*${EMPTY}*`);
            const params = this.getParams(zip);
            let v = ZipVersion.Version0;
            if (params[Section.Version]) {
              v = params[Section.Version] as ZipVersion;
            }
            const state: App.PartialState = {};
            switch (v) {
              case ZipVersion.Version0: {
                if (params[Section.Products]) {
                  state.productsState = this.unzipProducts(params, v);
                }
                let preset: Preset | undefined;
                if (params[Section.Base]) {
                  preset = this.parseNumber(params[Section.Base]);
                }
                if (params[Section.Items]) {
                  state.itemsState = this.unzipItems(params, v);
                }
                if (params[Section.Recipes]) {
                  state.recipesState = this.unzipRecipes(params, v);
                }
                if (params[Section.Factories]) {
                  state.factoriesState = this.unzipFactories(params, v);
                }
                if (params[Section.Settings]) {
                  state.settingsState = this.unzipSettings(params, v);
                }
                if (preset != null) {
                  state.settingsState = {
                    ...state.settingsState,
                    ...{ preset },
                  };
                }
                this.dispatch(zip, state);
                break;
              }
              case ZipVersion.Version1: {
                Object.keys(params).forEach((k) => {
                  params[k] = decodeURIComponent(params[k]);
                });
                if (params[Section.Products]) {
                  state.productsState = this.unzipProducts(params, v);
                }
                if (params[Section.Items]) {
                  state.itemsState = this.unzipItems(params, v);
                }
                if (params[Section.Recipes]) {
                  state.recipesState = this.unzipRecipes(params, v);
                }
                if (params[Section.Factories]) {
                  state.factoriesState = this.unzipFactories(params, v);
                }
                if (params[Section.Settings]) {
                  state.settingsState = this.unzipSettings(params, v);
                }
                this.dispatch(zip, state);
                break;
              }
              case ZipVersion.Version2:
              case ZipVersion.Version3: {
                const baseId = this.parseNString(
                  params[Section.Base],
                  data.hash
                );
                this.store
                  .select(Datasets.getHashEntities)
                  .pipe(
                    map(
                      (hashEntities) =>
                        hashEntities[
                          baseId || Settings.initialSettingsState.baseId
                        ]
                    ),
                    filter((e): e is ModHash => e != null),
                    first()
                  )
                  .subscribe((hash) => {
                    if (params[Section.Products]) {
                      state.productsState = this.unzipProducts(params, v, hash);
                    }
                    if (params[Section.Items]) {
                      state.itemsState = this.unzipItems(params, v, hash);
                    }
                    if (params[Section.Recipes]) {
                      state.recipesState = this.unzipRecipes(params, v, hash);
                    }
                    if (params[Section.Factories]) {
                      state.factoriesState = this.unzipFactories(
                        params,
                        v,
                        hash
                      );
                    }
                    if (params[Section.Settings]) {
                      state.settingsState = this.unzipSettings(params, v, hash);
                    }
                    if (baseId != null) {
                      state.settingsState = {
                        ...state.settingsState,
                        ...{ baseId },
                      };
                    }
                    this.dispatch(zip, state);
                  });
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      throw new Error('Router failed to parse url');
    }
  }

  dispatch(zip: string, state: App.PartialState): void {
    this.zip = zip;
    this.store.dispatch(new App.LoadAction(state));
  }

  zipProducts(products: Product[], hash: ModHash): Zip {
    const z = this.zipList(
      products.map((obj) => {
        const r = Rational.fromString(obj.rate).toString();
        const t = this.zipDiffNumber(obj.rateType, RateType.Items);

        return {
          bare: this.zipFields([
            obj.itemId,
            r,
            t,
            this.zipTruthyString(obj.viaId),
            this.zipTruthyString(obj.viaSetting),
            this.zipTruthyArray(obj.viaFactoryModuleIds),
            this.zipTruthyString(obj.viaBeaconCount),
            this.zipTruthyArray(obj.viaBeaconModuleIds),
            this.zipTruthyString(obj.viaBeaconId),
            this.zipTruthyNumber(obj.viaOverclock),
          ]),
          hash: this.zipFields([
            this.zipTruthyNString(obj.itemId, hash.items),
            r,
            t,
            this.zipTruthyNString(
              obj.viaId,
              obj.rateType === RateType.Factories ? hash.recipes : hash.items
            ),
            this.zipTruthyNString(
              obj.viaSetting,
              obj.rateType === RateType.Belts
                ? hash.belts
                : obj.rateType === RateType.Wagons
                ? hash.wagons
                : obj.rateType === RateType.Factories
                ? hash.factories
                : hash.items
            ),
            this.zipTruthyNArray(obj.viaFactoryModuleIds, hash.modules),
            this.zipTruthyString(obj.viaBeaconCount),
            this.zipTruthyNArray(obj.viaBeaconModuleIds, hash.modules),
            this.zipTruthyNString(obj.viaBeaconId, hash.beacons),
            this.zipTruthyNumber(obj.viaOverclock),
          ]),
        };
      })
    );

    return {
      bare: `${Section.Products}=${z.bare}`,
      hash: `${Section.Products}${z.hash}`,
    };
  }

  unzipProducts(
    params: Entities,
    v: ZipVersion,
    hash?: ModHash
  ): Products.ProductsState {
    const list = params[Section.Products].split(LISTSEP);
    const ids: string[] = [];
    const entities: Entities<Product> = {};
    let index = 0;
    for (const product of list) {
      const s = product.split(FIELDSEP);
      let i = 0;
      const id = index.toString();
      let obj: Product;

      switch (v) {
        case ZipVersion.Version0:
        case ZipVersion.Version1: {
          obj = {
            id,
            itemId: s[i++],
            rate: s[i++],
            rateType: Number(s[i++]) | RateType.Items,
            viaId: this.parseString(s[i++]),
            viaSetting: this.parseString(s[i++]),
            viaFactoryModuleIds: this.parseArray(s[i++]),
            viaBeaconCount: this.parseString(s[i++]),
            viaBeaconModuleIds: this.parseArray(s[i++]),
            viaBeaconId: this.parseString(s[i++]),
            viaOverclock: this.parseNumber(s[i++]),
          };
          break;
        }
        case ZipVersion.Version2:
        case ZipVersion.Version3: {
          if (hash == null) {
            throw new Error('Attempted to parse zipped state without hash');
          }
          obj = {
            id,
            itemId: this.parseNString(s[i++], hash.items) ?? '',
            rate: s[i++],
            rateType: Number(s[i++]) | RateType.Items,
          };
          obj.viaId = this.parseNString(
            s[i++],
            obj.rateType === RateType.Factories ? hash.recipes : hash.items
          );
          obj.viaSetting = this.parseNString(
            s[i++],
            obj.rateType === RateType.Belts
              ? hash.belts
              : obj.rateType === RateType.Wagons
              ? hash.wagons
              : obj.rateType === RateType.Factories
              ? hash.factories
              : hash.items
          );
          obj.viaFactoryModuleIds = this.parseNArray(s[i++], hash.modules);
          obj.viaBeaconCount = this.parseString(s[i++]);
          obj.viaBeaconModuleIds = this.parseNArray(s[i++], hash.modules);
          obj.viaBeaconId = this.parseNString(s[i++], hash.beacons);
          obj.viaOverclock = this.parseNumber(s[i++]);
          break;
        }
      }

      Object.keys(obj)
        .filter((k) => (obj as Record<string, any>)[k] === undefined)
        .forEach((k) => {
          delete (obj as Record<string, any>)[k];
        });

      ids.push(id);
      entities[id] = obj;
      index++;
    }
    return { ids, index, entities };
  }

  zipItems(partial: Zip, state: Items.ItemsState, hash: ModHash): void {
    const z = this.zipList(
      Object.keys(state).map((i) => {
        const obj = state[i];
        const g = this.zipTruthyBool(obj.ignore);

        return {
          bare: this.zipFields([
            i,
            g,
            this.zipTruthyString(obj.beltId),
            this.zipTruthyString(obj.wagonId),
            this.zipTruthyString(obj.recipeId),
          ]),
          hash: this.zipFields([
            this.zipTruthyNString(i, hash.items),
            g,
            this.zipTruthyNString(obj.beltId, hash.belts),
            this.zipTruthyNString(obj.wagonId, hash.wagons),
            this.zipTruthyNString(obj.recipeId, hash.recipes),
          ]),
        };
      })
    );

    if (z.bare.length) {
      partial.bare += `&${Section.Items}=${z.bare}`;
      partial.hash += `&${Section.Items}${z.hash}`;
    }
  }

  unzipItems(
    params: Entities,
    v: ZipVersion,
    hash?: ModHash
  ): Items.ItemsState {
    const list = params[Section.Items].split(LISTSEP);
    const entities: Items.ItemsState = {};
    for (const item of list) {
      const s = item.split(FIELDSEP);
      let i = 0;
      let id: string;
      let obj: ItemSettings;

      switch (v) {
        case ZipVersion.Version0:
        case ZipVersion.Version1: {
          id = s[i++];
          obj = {
            ignore: this.parseBool(s[i++]),
            beltId: this.parseString(s[i++]),
            wagonId: this.parseString(s[i++]),
            recipeId: this.parseString(s[i++]),
          };
          break;
        }
        case ZipVersion.Version2:
        case ZipVersion.Version3: {
          if (hash == null) {
            throw new Error('Attempted to parse zipped state without hash');
          }
          id = this.parseNString(s[i++], hash.items) ?? '';
          obj = {
            ignore: this.parseBool(s[i++]),
            beltId: this.parseNString(s[i++], hash.belts),
            wagonId: this.parseNString(s[i++], hash.wagons),
            recipeId: this.parseNString(s[i++], hash.recipes),
          };
          break;
        }
      }

      Object.keys(obj)
        .filter((k) => (obj as Record<string, any>)[k] === undefined)
        .forEach((k) => {
          delete (obj as Record<string, any>)[k];
        });

      entities[id] = obj;
    }
    return entities;
  }

  zipRecipes(partial: Zip, state: Recipes.RecipesState, hash: ModHash): void {
    const z = this.zipList(
      Object.keys(state).map((i) => {
        const obj = state[i];

        return {
          bare: this.zipFields([
            i,
            this.zipTruthyString(obj.factoryId),
            this.zipTruthyArray(obj.factoryModuleIds),
            this.zipTruthyString(obj.beaconCount),
            this.zipTruthyArray(obj.beaconModuleIds),
            this.zipTruthyString(obj.beaconId),
            this.zipTruthyNumber(obj.overclock),
            this.zipTruthyString(obj.cost),
            this.zipTruthyString(obj.beaconTotal),
          ]),
          hash: this.zipFields([
            this.zipTruthyNString(i, hash.recipes),
            this.zipTruthyNString(obj.factoryId, hash.factories),
            this.zipTruthyNArray(obj.factoryModuleIds, hash.modules),
            this.zipTruthyString(obj.beaconCount),
            this.zipTruthyNArray(obj.beaconModuleIds, hash.modules),
            this.zipTruthyNString(obj.beaconId, hash.beacons),
            this.zipTruthyNumber(obj.overclock),
            this.zipTruthyString(obj.cost),
            this.zipTruthyString(obj.beaconTotal),
          ]),
        };
      })
    );

    if (z.bare.length) {
      partial.bare += `&${Section.Recipes}=${z.bare}`;
      partial.hash += `&${Section.Recipes}${z.hash}`;
    }
  }

  unzipRecipes(
    params: Entities,
    v: ZipVersion,
    hash?: ModHash
  ): Recipes.RecipesState {
    const list = params[Section.Recipes].split(LISTSEP);
    const entities: Recipes.RecipesState = {};
    for (const recipe of list) {
      const s = recipe.split(FIELDSEP);
      let i = 0;
      let id: string;
      let obj: RecipeSettings;

      switch (v) {
        case ZipVersion.Version0:
        case ZipVersion.Version1: {
          id = s[i++];
          obj = {
            factoryId: this.parseString(s[i++]),
            factoryModuleIds: this.parseArray(s[i++]),
            beaconCount: this.parseString(s[i++]),
            beaconModuleIds: this.parseArray(s[i++]),
            beaconId: this.parseString(s[i++]),
            overclock: this.parseNumber(s[i++]),
            cost: this.parseString(s[i++]),
            beaconTotal: this.parseString(s[i++]),
          };
          break;
        }
        case ZipVersion.Version2:
        case ZipVersion.Version3: {
          if (hash == null) {
            throw new Error('Attempted to parse zipped state without hash');
          }
          id = this.parseNString(s[i++], hash.recipes) ?? '';
          obj = {
            factoryId: this.parseNString(s[i++], hash.factories),
            factoryModuleIds: this.parseNArray(s[i++], hash.modules),
            beaconCount:
              v === ZipVersion.Version2
                ? this.parseNNumber(s[i++])?.toString()
                : this.parseString(s[i++]),
            beaconModuleIds: this.parseNArray(s[i++], hash.modules),
            beaconId: this.parseNString(s[i++], hash.beacons),
            overclock: this.parseNumber(s[i++]),
            cost: this.parseString(s[i++]),
            beaconTotal: this.parseString(s[i++]),
          };
          break;
        }
      }

      Object.keys(obj)
        .filter((k) => (obj as Record<string, any>)[k] === undefined)
        .forEach((k) => {
          delete (obj as Record<string, any>)[k];
        });

      entities[id] = obj;
    }
    return entities;
  }

  zipFactories(
    partial: Zip,
    state: Factories.FactoriesState,
    hash: ModHash
  ): void {
    const ids = state.ids ? ['', ...state.ids] : Object.keys(state.entities);
    const z = this.zipList(
      ids.map((i) => {
        const obj = state.entities[i] || {};
        let h = true;
        if (i === '') {
          i = state.ids == null ? '' : TRUE;
          h = false;
        }
        return {
          bare: this.zipFields([
            i,
            this.zipTruthyArray(obj.moduleRankIds),
            this.zipTruthyString(obj.beaconCount),
            this.zipTruthyString(obj.beaconModuleId),
            this.zipTruthyString(obj.beaconId),
            this.zipTruthyNumber(obj.overclock),
          ]),
          hash: this.zipFields([
            h ? this.zipTruthyNString(i, hash.factories) : i,
            this.zipTruthyNArray(obj.moduleRankIds, hash.modules),
            this.zipTruthyString(obj.beaconCount),
            this.zipTruthyNString(obj.beaconModuleId, hash.modules),
            this.zipTruthyNString(obj.beaconId, hash.beacons),
            this.zipTruthyNumber(obj.overclock),
          ]),
        };
      })
    );

    if (z.bare.length) {
      partial.bare += `&${Section.Factories}=${z.bare}`;
      partial.hash += `&${Section.Factories}${z.hash}`;
    }
  }

  unzipFactories(
    params: Entities,
    v: ZipVersion,
    hash?: ModHash
  ): Factories.FactoriesState {
    const list = params[Section.Factories].split(LISTSEP);
    let ids: string[] | undefined;
    const entities: Entities<FactorySettings> = {};
    let loadIds = false;
    for (let z = 0; z < list.length; z++) {
      const factory = list[z];
      const s = factory.split(FIELDSEP);
      let i = 0;
      let id: string | undefined;
      let obj: Partial<FactorySettings>;

      switch (v) {
        case ZipVersion.Version0:
        case ZipVersion.Version1: {
          id = s[i++];
          obj = {
            moduleRankIds: this.parseArray(s[i++]),
            beaconCount: this.parseString(s[i++]),
            beaconModuleId: this.parseString(s[i++]),
            beaconId: this.parseString(s[i++]),
            overclock: this.parseNumber(s[i++]),
          };
          if (z === 0 && id === TRUE) {
            loadIds = true;
            ids = [];
            id = '';
          } else if (loadIds && ids != null) {
            ids.push(id);
          }
          break;
        }
        case ZipVersion.Version2:
        case ZipVersion.Version3: {
          if (hash == null) {
            throw new Error('Attempted to parse zipped state without hash');
          }
          id = s[i++];
          obj = {
            moduleRankIds: this.parseNArray(s[i++], hash.modules),
            beaconCount:
              v === ZipVersion.Version2
                ? this.parseNNumber(s[i++])?.toString()
                : this.parseString(s[i++]),
            beaconModuleId: this.parseNString(s[i++], hash.modules),
            beaconId: this.parseNString(s[i++], hash.beacons),
            overclock: this.parseNumber(s[i++]),
          };
          if (z === 0 && id === TRUE) {
            loadIds = true;
            ids = [];
            id = '';
          } else {
            if (id) {
              id = this.parseNString(id, hash.factories);
            }
            if (loadIds && ids != null) {
              ids.push(id ?? '');
            }
          }
          break;
        }
      }

      Object.keys(obj)
        .filter((k) => (obj as Record<string, any>)[k] === undefined)
        .forEach((k) => {
          delete (obj as Record<string, any>)[k];
        });

      if (Object.keys(obj).length) {
        entities[id ?? ''] = obj;
      }
    }
    return { ids, entities };
  }

  zipSettings(
    partial: Zip,
    state: Settings.SettingsState,
    hash: ModHash
  ): void {
    const init = Settings.initialSettingsState;
    const z: Zip = {
      bare: this.zipFields([
        this.zipDiffString(state.baseId, init.baseId),
        this.zipDiffDisplayRate(state.displayRate, init.displayRate),
        this.zipDiffNumber(state.preset, init.preset),
        this.zipDiffArray(state.disabledRecipeIds, init.disabledRecipeIds),
        this.zipDiffString(state.beltId, init.beltId),
        this.zipDiffString(state.fuelId, init.fuelId),
        this.zipDiffNumber(state.flowRate, init.flowRate),
        this.zipDiffNumber(state.miningBonus, init.miningBonus),
        this.zipDiffNumber(state.researchSpeed, init.researchSpeed),
        this.zipDiffNumber(state.inserterCapacity, init.inserterCapacity),
        this.zipDiffNumber(state.inserterTarget, init.inserterTarget),
        this.zipDiffBool(state.expensive, init.expensive),
        this.zipDiffString(state.cargoWagonId, init.cargoWagonId),
        this.zipDiffString(state.fluidWagonId, init.fluidWagonId),
        this.zipDiffString(state.pipeId, init.pipeId),
        this.zipDiffString(state.costFactor, init.costFactor),
        this.zipDiffString(state.costFactory, init.costFactory),
        this.zipDiffString(state.costInput, init.costInput),
        this.zipDiffString(state.costIgnored, init.costIgnored),
        this.zipDiffString(state.beaconReceivers, init.beaconReceivers),
        this.zipDiffString(state.proliferatorSprayId, init.proliferatorSprayId),
      ]),
      hash: this.zipFields([
        this.zipDiffDisplayRate(state.displayRate, init.displayRate),
        this.zipDiffNumber(state.preset, init.preset),
        this.zipDiffNArray(
          state.disabledRecipeIds,
          init.disabledRecipeIds,
          hash.recipes
        ),
        this.zipDiffNString(state.beltId, init.beltId, hash.belts),
        this.zipDiffNString(state.fuelId, init.fuelId, hash.fuels),
        this.zipDiffNNumber(state.flowRate, init.flowRate),
        this.zipDiffNNumber(state.miningBonus, init.miningBonus),
        this.zipDiffNNumber(state.researchSpeed, init.researchSpeed),
        this.zipDiffNumber(state.inserterCapacity, init.inserterCapacity),
        this.zipDiffNumber(state.inserterTarget, init.inserterTarget),
        this.zipDiffBool(state.expensive, init.expensive),
        this.zipDiffNString(state.cargoWagonId, init.cargoWagonId, hash.wagons),
        this.zipDiffNString(state.fluidWagonId, init.fluidWagonId, hash.wagons),
        this.zipDiffNString(state.pipeId, init.pipeId, hash.belts),
        this.zipDiffString(state.costFactor, init.costFactor),
        this.zipDiffString(state.costFactory, init.costFactory),
        this.zipDiffString(state.costInput, init.costInput),
        this.zipDiffString(state.costIgnored, init.costIgnored),
        this.zipDiffString(state.beaconReceivers, init.beaconReceivers),
        this.zipDiffNString(
          state.proliferatorSprayId,
          init.proliferatorSprayId,
          hash.modules
        ),
      ]),
    };

    if (z.bare.length) {
      partial.bare += `&${Section.Settings}=${z.bare}`;
      partial.hash += `&${Section.Settings}${z.hash}`;
    }
  }

  unzipSettings(
    params: Entities,
    v: ZipVersion,
    hash?: ModHash
  ): Partial<Settings.SettingsState> {
    const zip = params[Section.Settings];
    const s = zip.split(FIELDSEP);
    let i = 0;
    let obj: Partial<Settings.SettingsState>;

    switch (v) {
      case ZipVersion.Version0: {
        const baseId = this.parseString(s[i++]);
        obj = {
          baseId: baseId && data.hash[data.v0.indexOf(baseId)],
          disabledRecipeIds: this.parseArray(s[i++]),
          expensive: this.parseBool(s[i++]),
          beltId: this.parseString(s[i++]),
          fuelId: this.parseString(s[i++]),
          flowRate: this.parseNumber(s[i++]),
          displayRate: this.parseNumber(s[i++]),
          miningBonus: this.parseNumber(s[i++]),
          researchSpeed: this.parseNumber(s[i++]),
          inserterTarget: this.parseNumber(s[i++]),
          inserterCapacity: this.parseNumber(s[i++]),
          cargoWagonId: this.parseString(s[i++]),
          fluidWagonId: this.parseString(s[i++]),
          pipeId: this.parseString(s[i++]),
          costFactor: this.parseString(s[i++]),
          costFactory: this.parseString(s[i++]),
          costInput: this.parseString(s[i++]),
          costIgnored: this.parseString(s[i++]),
          beaconReceivers: this.parseString(s[i++]),
          proliferatorSprayId: this.parseString(s[i++]),
        };
        break;
      }
      case ZipVersion.Version1: {
        obj = {
          baseId: this.parseString(s[i++]),
          displayRate: this.parseDisplayRate(s[i++]),
          preset: this.parseNumber(s[i++]),
          disabledRecipeIds: this.parseArray(s[i++]),
          beltId: this.parseString(s[i++]),
          fuelId: this.parseString(s[i++]),
          flowRate: this.parseNumber(s[i++]),
          miningBonus: this.parseNumber(s[i++]),
          researchSpeed: this.parseNumber(s[i++]),
          inserterCapacity: this.parseNumber(s[i++]),
          inserterTarget: this.parseNumber(s[i++]),
          expensive: this.parseBool(s[i++]),
          cargoWagonId: this.parseString(s[i++]),
          fluidWagonId: this.parseString(s[i++]),
          pipeId: this.parseString(s[i++]),
          costFactor: this.parseString(s[i++]),
          costFactory: this.parseString(s[i++]),
          costInput: this.parseString(s[i++]),
          costIgnored: this.parseString(s[i++]),
          beaconReceivers: this.parseString(s[i++]),
          proliferatorSprayId: this.parseString(s[i++]),
        };
        break;
      }
      case ZipVersion.Version2:
      case ZipVersion.Version3: {
        if (hash == null) {
          throw new Error('Attempted to parse zipped state without hash');
        }
        obj = {
          displayRate: this.parseDisplayRate(s[i++]),
          preset: this.parseNumber(s[i++]),
          disabledRecipeIds: this.parseNArray(s[i++], hash.recipes),
          beltId: this.parseNString(s[i++], hash.belts),
          fuelId: this.parseNString(s[i++], hash.fuels),
          flowRate: this.parseNNumber(s[i++]),
          miningBonus: this.parseNNumber(s[i++]),
          researchSpeed: this.parseNNumber(s[i++]),
          inserterCapacity: this.parseNumber(s[i++]),
          inserterTarget: this.parseNumber(s[i++]),
          expensive: this.parseBool(s[i++]),
          cargoWagonId: this.parseNString(s[i++], hash.wagons),
          fluidWagonId: this.parseNString(s[i++], hash.wagons),
          pipeId: this.parseNString(s[i++], hash.belts),
          costFactor: this.parseString(s[i++]),
          costFactory: this.parseString(s[i++]),
          costInput: this.parseString(s[i++]),
          costIgnored: this.parseString(s[i++]),
          beaconReceivers: this.parseString(s[i++]),
          proliferatorSprayId: this.parseNString(s[i++], hash.modules),
        };
        break;
      }
    }

    Object.keys(obj)
      .filter((k) => (obj as Record<string, any>)[k] === undefined)
      .forEach((k) => {
        delete (obj as Record<string, any>)[k];
      });

    return obj;
  }

  zipList(list: Zip[]): Zip {
    return {
      bare: encodeURIComponent(list.map((i) => i.bare).join(LISTSEP)),
      hash: list.map((i) => i.hash).join(LISTSEP),
    };
  }

  zipFields(fields: string[]): string {
    return fields.join(FIELDSEP).replace(/\**$/, '');
  }

  zipTruthyString(value: string | undefined): string {
    return value == null ? '' : value;
  }

  zipTruthyNumber(value: number | undefined): string {
    return value == null ? '' : value.toString();
  }

  zipTruthyBool(value: boolean | undefined): string {
    return value == null ? '' : value ? TRUE : FALSE;
  }

  zipTruthyArray(value: string[] | undefined): string {
    return value == null ? '' : value.length ? value.join(ARRAYSEP) : EMPTY;
  }

  zipTruthyNString(value: string | undefined, hash: string[]): string {
    return value == null ? '' : this.getId(hash.indexOf(value));
  }

  zipTruthyNArray(value: string[] | undefined, hash: string[]): string {
    return value == null
      ? ''
      : value.length
      ? value.map((v) => this.getId(hash.indexOf(v))).join(ARRAYSEP)
      : EMPTY;
  }

  zipDiffString(
    value: string | null | undefined,
    init: string | null | undefined
  ): string {
    return value === init ? '' : value == null ? NULL : value;
  }

  zipDiffNumber(value: number | undefined, init: number | undefined): string {
    return value === init ? '' : value == null ? NULL : value.toString();
  }

  zipDiffDisplayRate(
    value: DisplayRate | undefined,
    init: DisplayRate | undefined
  ): string {
    if (value === init) {
      return '';
    }
    switch (value) {
      case DisplayRate.PerSecond:
        return '0';
      case DisplayRate.PerMinute:
        return '1';
      case DisplayRate.PerHour:
        return '2';
      default:
        return NULL;
    }
  }

  zipDiffBool(value: boolean | undefined, init: boolean | undefined): string {
    return value === init ? '' : value == null ? NULL : value ? TRUE : FALSE;
  }

  zipDiffArray(
    value: string[] | undefined,
    init: string[] | undefined
  ): string {
    const zVal =
      value != null
        ? value.length > 0
          ? [...value].sort().join(ARRAYSEP)
          : EMPTY
        : NULL;
    const zInit =
      init != null
        ? init.length > 0
          ? [...init].sort().join(ARRAYSEP)
          : EMPTY
        : NULL;
    return zVal === zInit ? '' : zVal;
  }

  zipDiffRank(value: string[] | undefined, init: string[] | undefined): string {
    const zVal = value ? (value.length ? value.join(ARRAYSEP) : EMPTY) : NULL;
    const zInit = init ? (init.length ? init.join(ARRAYSEP) : EMPTY) : NULL;
    return zVal === zInit ? '' : zVal;
  }

  zipDiffNString(
    value: string | undefined,
    init: string | undefined,
    hash: string[]
  ): string {
    return value === init
      ? ''
      : value == null
      ? NULL
      : this.getId(hash.indexOf(value));
  }

  zipDiffNNumber(value: number | undefined, init: number | undefined): string {
    return value === init ? '' : value == null ? NULL : this.getId(value);
  }

  zipDiffNArray(
    value: string[] | undefined,
    init: string[] | undefined,
    hash: string[]
  ): string {
    const zVal =
      value != null
        ? value.length > 0
          ? value
              .map((v) => this.getId(hash.indexOf(v)))
              .sort()
              .join(ARRAYSEP)
          : EMPTY
        : NULL;
    const zInit =
      init != null
        ? init.length > 0
          ? init
              .map((v) => this.getId(hash.indexOf(v)))
              .sort()
              .join(ARRAYSEP)
          : EMPTY
        : NULL;
    return zVal === zInit ? '' : zVal;
  }

  zipDiffNRank(
    value: string[] | undefined,
    init: string[] | undefined,
    hash: string[]
  ): string {
    const zVal = value
      ? value.length
        ? value.map((v) => this.getId(hash.indexOf(v))).join(ARRAYSEP)
        : EMPTY
      : NULL;
    const zInit = init
      ? init.length
        ? init.map((v) => this.getId(hash.indexOf(v))).join(ARRAYSEP)
        : EMPTY
      : NULL;
    return zVal === zInit ? '' : zVal;
  }

  parseString(value: string | undefined): string | undefined {
    if (!value?.length || value === NULL) {
      return undefined;
    }
    return value;
  }

  parseBool(value: string | undefined): boolean | undefined {
    if (!value?.length || value === NULL) {
      return undefined;
    }
    return value === TRUE;
  }

  parseNumber(value: string | undefined): number | undefined {
    if (!value?.length || value === NULL) {
      return undefined;
    }
    return Number(value);
  }

  parseDisplayRate(value: string | undefined): DisplayRate | undefined {
    if (!value?.length || value === NULL) {
      return undefined;
    }
    switch (value) {
      case '0':
        return DisplayRate.PerSecond;
      case '1':
        return DisplayRate.PerMinute;
      case '2':
        return DisplayRate.PerHour;
      default:
        return undefined;
    }
  }

  parseArray(value: string | undefined): string[] | undefined {
    if (!value?.length || value === NULL) {
      return undefined;
    }
    return value === EMPTY ? [] : value.split(ARRAYSEP);
  }

  parseNString(value: string | undefined, hash: string[]): string | undefined {
    const v = this.parseString(value);
    if (v == null) {
      return v;
    }
    return hash[this.getN(v)];
  }

  parseNNumber(value: string | undefined): number | undefined {
    if (!value?.length || value === NULL) {
      return undefined;
    }
    return this.getN(value);
  }

  parseNArray(value: string | undefined, hash: string[]): string[] | undefined {
    const v = this.parseArray(value);
    if (v == null) {
      return v;
    }
    return v.map((a) => hash[this.getN(a)]);
  }

  getId(n: number): string {
    if (n / MAX >= 1) {
      return this.getId(Math.floor(n / MAX)) + this.getId(n % MAX);
    } else {
      return BASE64ABC[n];
    }
  }

  getN(id: string): number {
    const n = INVERT[id[0]];
    if (id.length > 1) {
      id = id.substring(1);
      return n * Math.pow(MAX, id.length) + this.getN(id);
    } else {
      return n;
    }
  }

  getBase64Code(charCode: number): number {
    if (charCode >= this.base64codes.length) {
      throw new Error('Unable to parse base64 string.');
    }
    const code = this.base64codes[charCode];
    if (code === 255) {
      throw new Error('Unable to parse base64 string.');
    }
    return code;
  }

  bytesToBase64(bytes: Uint8Array): string {
    let result = '';
    let i: number;
    const l = bytes.length;
    for (i = 2; i < l; i += 3) {
      result += BASE64ABC[bytes[i - 2] >> 2];
      result += BASE64ABC[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
      result += BASE64ABC[((bytes[i - 1] & 0x0f) << 2) | (bytes[i] >> 6)];
      result += BASE64ABC[bytes[i] & 0x3f];
    }
    if (i === l + 1) {
      // 1 octet yet to write
      result += BASE64ABC[bytes[i - 2] >> 2];
      result += BASE64ABC[(bytes[i - 2] & 0x03) << 4];
      result += '__';
    }
    if (i === l) {
      // 2 octets yet to write
      result += BASE64ABC[bytes[i - 2] >> 2];
      result += BASE64ABC[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
      result += BASE64ABC[(bytes[i - 1] & 0x0f) << 2];
      result += '_';
    }
    return result;
  }

  inflateSafe(str: string): string {
    try {
      return this.inflate(str);
    } catch {
      console.warn(
        'Router failed to parse url, checking for missing trailing characters...'
      );
    }
    try {
      return this.inflateMend(str, '-');
    } catch {}
    try {
      return this.inflateMend(str, '.');
    } catch {}
    return this.inflateMend(str, '_');
  }

  inflateMend(str: string, char: string): string {
    const z = this.inflate(str + char);
    console.warn(`Router mended url by appending '${char}'`);
    return z;
  }

  inflate(str: string): string {
    return inflate(this.base64ToBytes(str), { to: 'string' });
  }

  base64ToBytes(str: string): Uint8Array {
    if (str.length % 4 !== 0) {
      throw new Error('Unable to parse base64 string.');
    }
    const index = str.indexOf('_');
    if (index !== -1 && index < str.length - 2) {
      throw new Error('Unable to parse base64 string.');
    }
    const missingOctets = str.endsWith('__') ? 2 : str.endsWith('_') ? 1 : 0;
    const n = str.length;
    const result = new Uint8Array(3 * (n / 4));
    let buffer: number;
    for (let i = 0, j = 0; i < n; i += 4, j += 3) {
      buffer =
        (this.getBase64Code(str.charCodeAt(i)) << 18) |
        (this.getBase64Code(str.charCodeAt(i + 1)) << 12) |
        (this.getBase64Code(str.charCodeAt(i + 2)) << 6) |
        this.getBase64Code(str.charCodeAt(i + 3));
      result[j] = buffer >> 16;
      result[j + 1] = (buffer >> 8) & 0xff;
      result[j + 2] = buffer & 0xff;
    }
    return result.subarray(0, result.length - missingOctets);
  }
}
