import { createSelector } from '@ngrx/store';

import { Column, Game, LinkValue } from '~/models';
import { LabState } from '../';
import * as Settings from '../settings';
import {
  ColumnsState,
  initialColumnsState,
  PreferencesState,
} from './preferences.reducer';

/* Base selector functions */
export const preferencesState = (state: LabState): PreferencesState =>
  state.preferencesState;

export const getStates = createSelector(
  preferencesState,
  (state) => state.states
);
export const getColumns = createSelector(
  preferencesState,
  (state) => state.columns
);
export const getLinkSize = createSelector(
  preferencesState,
  (state) => state.linkSize
);
export const getLinkText = createSelector(
  preferencesState,
  (state) => state.linkText
);
export const getSankeyAlign = createSelector(
  preferencesState,
  (state) => state.sankeyAlign
);
export const getSimplex = createSelector(
  preferencesState,
  (state) => state.simplex
);
export const getPowerUnit = createSelector(
  preferencesState,
  (state) => state.powerUnit
);
export const getLanguage = createSelector(
  preferencesState,
  (state) => state.language
);

/** Complex selectors */
export const getColumnsState = createSelector(
  getColumns,
  Settings.getGame,
  (col, game): ColumnsState =>
    game === Game.DysonSphereProgram
      ? {
          ...initialColumnsState,
          ...col,
          ...{
            [Column.Wagons]: { ...col[Column.Wagons], ...{ show: false } },
            [Column.Overclock]: {
              ...col[Column.Overclock],
              ...{ show: false },
            },
            [Column.Beacons]: { ...col[Column.Beacons], ...{ show: false } },
            [Column.Pollution]: {
              ...col[Column.Pollution],
              ...{ show: false },
            },
          },
        }
      : game === Game.Satisfactory
      ? {
          ...initialColumnsState,
          ...col,
          ...{
            [Column.Beacons]: { ...col[Column.Beacons], ...{ show: false } },
            [Column.Pollution]: {
              ...col[Column.Pollution],
              ...{ show: false },
            },
          },
        }
      : {
          ...initialColumnsState,
          ...col,
          ...{
            [Column.Overclock]: {
              ...col[Column.Overclock],
              ...{ show: false },
            },
          },
        }
);

export const getLinkPrecision = createSelector(
  getLinkText,
  getColumns,
  (linkText, columns) => {
    switch (linkText) {
      case LinkValue.Items:
        return columns[Column.Items].precision;
      case LinkValue.Belts:
        return columns[Column.Belts].precision;
      case LinkValue.Wagons:
        return columns[Column.Wagons].precision;
      case LinkValue.Factories:
        return columns[Column.Factories].precision;
      default:
        return null;
    }
  }
);

export const getSimplexModifiers = createSelector(
  getSimplex,
  Settings.getRationalCostInput,
  Settings.getRationalCostIgnored,
  (simplex, costInput, costIgnored) => ({
    simplex,
    costInput,
    costIgnored,
  })
);

export const getSavedStates = createSelector(getStates, (states) =>
  Object.keys(states).map((i) => ({
    id: i,
    name: i,
  }))
);

export const getColumnsVisible = createSelector(
  getColumns,
  (columns) => Object.keys(columns).filter((c) => columns[c].show).length
);

export const getLanguageModifiers = createSelector(
  getLanguage,
  (getLanguage) => ({
    getLanguage,
  })
);
