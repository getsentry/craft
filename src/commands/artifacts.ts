import { Argv, CommandBuilder } from "yargs";

import * as download from "./artifacts_cmds/download";
import * as list from "./artifacts_cmds/list";

export const command = ["artifacts <command>"];
export const aliases = ["a", "artifact"];
export const description = "📦 Manage artifacts";

/**
 * Common options for `artifacts` commands
 */
export interface ArtifactsOptions {
  rev: string;
}

export const builder: CommandBuilder = (yargs: Argv) =>
  yargs
    .option("rev", {
      alias: "r",
      description: "Revision",
      type: "string",
    })
    .demandCommand()
    .demandOption("rev", "Please specify the revision")
    .command(list)
    .command(download);

// This dummy function is to please TypeScript
export const handler = (): void => {
  /* pass */
};
