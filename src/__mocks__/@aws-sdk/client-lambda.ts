/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

const PUBLISHED_LAYER_TEST = {
  Version: 1,
  LayerVersionArn: "test:layer:version:arn",
};

export class Lambda {
  public publishLayerVersion() {
    return PUBLISHED_LAYER_TEST;
  }

  public addLayerVersionPermission() {
    // Adding layer version permissions...
  }
}
