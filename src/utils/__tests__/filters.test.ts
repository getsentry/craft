import { stringToRegexp } from "../filters";

describe("stringToRegexp", () => {
  test("converts string without special characters", () => {
    expect(stringToRegexp("/simple/")).toEqual(/simple/);
  });

  test("converts string with special characters", () => {
    expect(stringToRegexp("/sim.le\\d+/")).toEqual(/sim.le\d+/);
  });

  test("uses regexp modifiers", () => {
    expect(stringToRegexp("/[!?]{2}\\w+/gi")).toEqual(/[!?]{2}\w+/gi);
  });

  test("is not confused by multiple slashes", () => {
    expect(stringToRegexp("/file1/file2/i")).toEqual(/file1\/file2/i);
  });

  test("is source of regex what we think", () => {
    expect(stringToRegexp("/none/").source).toEqual("none");
  });

  test("raises an error if the value is not surrounded by slashes", () => {
    expect.assertions(1);
    try {
      stringToRegexp("no-slashes");
    } catch (e) {
      expect(e.message).toMatch(/invalid regexp/i);
    }
  });
});
