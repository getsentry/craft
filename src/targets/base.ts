import { ZeusStore } from '../stores/zeus';

// TODO: make abstract?
export class BaseTarget {
  public readonly name: string = 'base';
  public readonly store: ZeusStore;
  public readonly config: any;

  public constructor(config: any, store: ZeusStore) {
    this.store = store;
    this.config = config;
  }

  public async publish(_version: string, _revision: string): Promise<any> {
    throw new Error('Not implemented');
  }
}
