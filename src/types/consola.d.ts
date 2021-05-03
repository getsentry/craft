declare module "consola" {
  interface Consola {
    fatal(...message: string[]): void;
    error(...message: string[]): void;
    warn(...message: string[]): void;
    log(...message: string[]): void;
    info(...message: string[]): void;
    start(...message: string[]): void;
    success(...message: string[]): void;
    debug(...message: string[]): void;
    ready(...message: string[]): void;
    withTag(tag: string): Consola;
    withScope(tag: string): Consola;
    level: number;
    reporters: any[];
  }

  let c: Consola;
  export = c;
}
