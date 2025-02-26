import { data } from 'src/data';
import { Mocks } from 'src/tests';
import { initialDatasetsState } from './datasets.reducer';
import * as Selectors from './datasets.selectors';

describe('Datasets Selectors', () => {
  describe('Base selector functions', () => {
    it('should get slices of state', () => {
      expect(Selectors.getAppData.projector(initialDatasetsState)).toEqual(
        initialDatasetsState.app
      );
      expect(Selectors.getDataEntities.projector(initialDatasetsState)).toEqual(
        initialDatasetsState.dataEntities
      );
      expect(Selectors.getHashEntities.projector(initialDatasetsState)).toEqual(
        initialDatasetsState.hashEntities
      );
    });
  });

  describe('getBaseEntities', () => {
    it('should convert base list to entities', () => {
      const result = Selectors.getBaseEntities.projector(data.base, {
        [Mocks.Base.id]: Mocks.BaseData,
      });
      expect(result[Mocks.Base.id]).toEqual(Mocks.Base);
    });
  });

  describe('getModEntities', () => {
    it('should convert mod list to entities', () => {
      const result = Selectors.getModEntities.projector(data.base, {
        [Mocks.Base.id]: Mocks.BaseData,
      });
      expect(result[Mocks.Base.id]).toEqual(Mocks.Base);
    });
  });
});
