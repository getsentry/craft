/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

export class EC2 {
  private params: any;

  constructor(params: { region: string }) {
    this.params = params;
  }

  public async describeRegions(_params: any) {
    return this.params.region;
  }
}
