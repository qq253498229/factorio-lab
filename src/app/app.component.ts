import { animate, style, transition, trigger } from '@angular/animations';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { combineLatest, map } from 'rxjs';

import { environment } from 'src/environments';
import { APP, Game, ItemId, MatrixResultType } from './models';
import { ErrorService, RouterService, StateService } from './services';
import { LabState } from './store';
import { getLanguageModifiers } from './store/preferences';
import * as Products from './store/products';
import * as Settings from './store/settings';

export const TITLE_LAB = 'title.lab';
export const TITLE_DSP = 'title.dsp';
export const TITLE_SFY = 'title.sfy';

@Component({
  selector: 'lab-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [
    trigger('slideLeftRight', [
      transition(':enter', [
        style({ marginLeft: '-23.25rem', marginRight: '1rem', opacity: 0 }),
        animate(
          '300ms ease',
          style({ marginLeft: '*', marginRight: '*', opacity: 1 })
        ),
      ]),
      transition(':leave', [
        style({ marginLeft: '*', marginRight: '*', opacity: 1 }),
        animate(
          '300ms ease',
          style({ marginLeft: '-23.25rem', marginRight: '1rem', opacity: 0 })
        ),
      ]),
    ]),
  ],
})
export class AppComponent implements OnInit, AfterViewInit {
  vm$ = combineLatest([
    this.store.select(Settings.getDatasets),
    this.store.select(Products.getProducts),
    this.store.select(Products.getMatrixResult),
  ]).pipe(
    map(([datasets, products, result]) => ({ datasets, products, result }))
  );

  title = 'Factory Calculator';
  homeHref: string | undefined;
  game = Game.Factorio;
  showSettings = false;
  poll = 'https://www.survey-maker.com/Q62LJFYVL';
  pollKey = 'poll1';
  showPoll = false;
  version = `${APP} ${environment.version}`;

  ItemId = ItemId;
  MatrixResultType = MatrixResultType;
  Game = Game;

  get lsHidePoll(): boolean {
    return !!localStorage.getItem(this.pollKey);
  }

  constructor(
    private ref: ChangeDetectorRef,
    private titleSvc: Title,
    private translateSvc: TranslateService,
    public errorSvc: ErrorService,
    private store: Store<LabState>,
    routerSvc: RouterService, // Included only to initialize the service
    stateSvc: StateService // Included only to initialize the service
  ) {
    translateSvc.setDefaultLang('en');
  }

  ngOnInit(): void {
    this.store.select(Settings.getGame).subscribe((game) => {
      this.game = game;
      switch (game) {
        case Game.Factorio:
          this.title = TITLE_LAB;
          this.homeHref = 'factorio';
          break;
        case Game.DysonSphereProgram:
          this.title = TITLE_DSP;
          this.homeHref = 'dsp';
          break;
        case Game.Satisfactory:
          this.title = TITLE_SFY;
          this.homeHref = 'satisfactory';
          break;
      }
      this.translateSvc.get(this.title).subscribe((r) => {
        this.titleSvc.setTitle(`${APP} | ${r}`);
      });
    });
    if (this.lsHidePoll) {
      this.showPoll = false;
    }
    this.store.select(getLanguageModifiers).subscribe((r) => {
      this.translateSvc.use(r.getLanguage);
    });
  }

  /**
   * This doesn't seem like it should be necessary,
   * but error message sometimes does not render without it
   * */
  ngAfterViewInit(): void {
    this.errorSvc.message$.subscribe(() => this.ref.detectChanges());
  }

  hidePoll(persist = false): void {
    if (persist) {
      localStorage.setItem(this.pollKey, 'hide');
    }
    this.showPoll = false;
  }
}
