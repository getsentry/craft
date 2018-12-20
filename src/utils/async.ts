import * as _ from 'lodash';

/**
 * Asynchronously calls the predicate on every element of the array and filters
 * for all elements where the predicate resolves to true.
 *
 * @param array An array to filter
 * @param predicate A predicate function that resolves to a boolean
 * @param thisArg Optional argument passed as this to the predicate
 * @returns The filtered array
 * @async
 */
export async function filterAsync<T>(
  array: T[],
  predicate: (arg: T) => boolean | Promise<boolean>,
  thisArg?: any
): Promise<T[]> {
  const verdicts = await Promise.all(array.map(predicate, thisArg));
  return array.filter((_element, index) => verdicts[index]);
}

/**
 * Returns a promise that resolves when each value of the given object resolves.
 * Works just like `Promise.all`, just on objects.
 *
 * @param object An object with one or more
 * @returns A promise that resolves with each value
 * @async
 */
export async function promiseProps(object: any): Promise<any> {
  const pairs = _.toPairs(object).map(async ([key, value]) => [
    key,
    await Promise.resolve(value),
  ]);

  return _.fromPairs(await Promise.all(pairs));
}

/**
 * Asynchronously calls the iteratee on each element of the array one element at
 * a time. This results in a chain of asynchronous actions that resolves once
 * the last item action has completed. In contrast, `Promise.all` exectues each
 * promise simultaneously.
 *
 * The iteratee is invoked as with `Array.forEach`: It receives the current
 * element, index and the array. This is bound to `thisArg` if present.
 *
 * @param array An array to iterate over
 * @param iteratee An action function that receives the element
 * @param thisArg  Optional argument passed as this to the action
 * @returns Resolves when the last action has completed
 * @async
 */
export async function forEachChained<T>(
  array: T[],
  iteratee: (x: T) => any,
  thisArg?: any
): Promise<void> {
  return array.reduce(
    async (prev, current: T) =>
      prev.then(() => iteratee.apply(thisArg, [current])),
    Promise.resolve()
  );
}
