/**
 * Returns true or false depending on the value of process.env.DRY_RUN.
 *
 * @returns false if DRY_RUN is unset or is set to '', 'false', '0', or 'no',
 * true otherwise
 */
export function isDryRun(): boolean {
  const dryRun = process.env.DRY_RUN;
  return (
    Boolean(dryRun) && dryRun !== "false" && dryRun !== "0" && dryRun !== "no"
  );
}
