import { envToBool } from '../helpers';

describe('envToBool', () =>
  test.each([
    [undefined, false],
    [null, false],
    [false, false],
    ['undefined', false],
    ['null', false],
    ['', false],
    ['0', false],
    ['no', false],
    [true, true],
    ['true', true],
    [1, true],
    ['1', true],
    ['yes', true],
    ['dogs are great!', true],
  ])('From %j we should get "%s"', (envVar, result) =>
    expect(envToBool(envVar)).toBe(result),
  ));
