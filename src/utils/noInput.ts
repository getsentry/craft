let noInput: boolean | undefined;

/**
 * Returns true if no-input mode is activated
 */
export function hasNoInput(): boolean {
  if (noInput === undefined) {
    resetNoInput();
  }
  return !!noInput;
}

/**
 * Returns true if user input is allowed
 */
export function hasInput(): boolean {
  return !hasNoInput();
}

/**
 * Sets the new no-input mode value
 *
 * @param val New no-input mode value
 */
export function setNoInput(val: boolean): void {
  noInput = val;
}

/**
 * Resets no-input mode value to initial state
 *
 * By default, CRAFT_NO_INPUT environment variable is checked for
 * a true-ish value.
 */
export function resetNoInput(): void {
  const envVal = process.env.CRAFT_NO_INPUT || '';
  noInput =
    envVal === '0' || envVal.toLowerCase() === 'false' ? false : !!envVal;
}
