import { join as pathJoin } from "path";
import { spawnProcess, hasExecutable } from "../../utils/system";
import { runPostReleaseCommand } from "../publish";

jest.mock("../../utils/system");

describe("runPostReleaseCommand", () => {
  const newVersion = "2.3.4";
  const mockedSpawnProcess = spawnProcess as jest.Mock;
  const mockedHasExecutable = hasExecutable as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("default script", () => {
    test("runs when script exists", async () => {
      mockedHasExecutable.mockReturnValue(true);
      expect.assertions(1);

      await runPostReleaseCommand(newVersion);

      expect(mockedSpawnProcess).toBeCalledWith(
        "/bin/bash",
        [pathJoin("scripts", "post-release.sh"), "", newVersion],
        {
          env: {
            ...process.env,
            CRAFT_NEW_VERSION: newVersion,
            CRAFT_OLD_VERSION: "",
          },
        }
      );
    });

    test("skips when script does not exist", async () => {
      mockedHasExecutable.mockReturnValue(false);
      expect.assertions(1);

      await runPostReleaseCommand(newVersion);

      expect(mockedSpawnProcess).not.toBeCalled();
    });
  });

  test("runs with custom command", async () => {
    expect.assertions(1);

    await runPostReleaseCommand(
      newVersion,
      'python ./increase_version.py "argument 1"'
    );

    expect(mockedSpawnProcess).toBeCalledWith(
      "python",
      ["./increase_version.py", "argument 1", "", newVersion],
      {
        env: {
          ...process.env,
          CRAFT_NEW_VERSION: newVersion,
          CRAFT_OLD_VERSION: "",
        },
      }
    );
  });
});
