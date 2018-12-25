declare module 'dryrun' {
  function isDryRun(): boolean;
  function shouldPerform(): boolean;
  function setDryRun(active: boolean): void;
}
