// Some type definitions for Mustache 3.0.0
// Project: https://github.com/janl/mustache.js
// Definitions by: Mark Ashley Bell <https://github.com/markashleybell>, Manuel Thalmann <https://github.com/manuth>, Sentry.io <https://getsentry/sentry>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare module "mustache" {
  /**
   * Provides the functionality to render templates with `{{mustaches}}`.
   */
  interface MustacheStatic {
    /**
     * The name of the module.
     */
    name: string;

    /**
     * The version of the module.
     */
    version: string;

    /**
     * The opening and closing tags to parse.
     */
    tags: string;

    /**
     * A simple string scanner that is used by the template parser to find tokens in template strings.
     */
    Scanner: typeof MustacheScanner;

    /**
     * Represents a rendering context by wrapping a view object and maintaining a reference to the parent context.
     */
    Context: typeof MustacheContext;

    /**
     * Escapes HTML-characters.
     *
     * @param value
     * The string to escape.
     */
    escape: (value: string) => string;

    /**
     * Clears all cached templates in this writer.
     */
    clearCache(): void;

    /**
     * Parses and caches the given template in the default writer and returns the array of tokens it contains.
     *
     * Doing this ahead of time avoids the need to parse templates on the fly as they are rendered.
     *
     * @param template
     * The template to parse.
     *
     * @param tags
     * The tags to use.
     */
    parse(template: string, tags?: string[]): any;

    /**
     * Renders the `template` with the given `view` and `partials` using the default writer.
     *
     * @param template
     * The template to render.
     *
     * @param view
     * The view to render the template with.
     *
     * @param partials
     * Either an object that contains the names and templates of partials that are used in a template
     *
     * -- or --
     *
     * A function that is used to load partial template on the fly that takes a single argument: the name of the partial.
     */
    render(
      template: string,
      view: any | MustacheContext,
      partials?: any,
      tags?: string[]
    ): string;

    /**
     * Renders the `template` with the given `view` and `partials` using the default writer.
     *
     * @param template
     * The template to render.
     *
     * @param view
     * The view to render the template with.
     *
     * @param partials
     * Either an object that contains the names and templates of partials that are used in a template
     *
     * -- or --
     *
     * A function that is used to load partial template on the fly that takes a single argument: the name of the partial.
     */
    to_html(
      template: string,
      view: any | MustacheContext,
      partials?: any,
      send?: any
    ): any;
  }

  /**
   * A simple string scanner that is used by the template parser to find tokens in template strings.
   */
  class MustacheScanner {
    string: string;
    tail: string;
    pos: number;

    /**
     * Initializes a new instance of the `MustacheScanner` class.
     */
    constructor(string: string);

    /**
     * Returns `true` if the tail is empty (end of string).
     */
    eos(): boolean;

    /**
     * Tries to match the given regular expression at the current position.
     *
     * @param re
     * The regex-pattern to match.
     *
     * @returns
     * The matched text if it can match, the empty string otherwise.
     */
    scan(re: RegExp): string;

    /**
     * Skips all text until the given regular expression can be matched.
     *
     * @param re
     * The regex-pattern to match.
     *
     * @returns
     * Returns the skipped string, which is the entire tail if no match can be made.
     */
    scanUntil(re: RegExp): string;
  }

  /**
   * Represents a rendering context by wrapping a view object and maintaining a reference to the parent context.
   */
  class MustacheContext {
    view: any;
    parentContext: MustacheContext;

    /**
     * Initializes a new instance of the `MustacheContenxt` class.
     */
    constructor(view: any, parentContext: MustacheContext);

    /**
     * Initializes a new instance of the `MustacheContenxt` class.
     */
    constructor(view: any);

    /**
     * Creates a new context using the given view with this context as the parent.
     *
     * @param view
     * The view to create the new context with.
     */
    push(view: any): MustacheContext;

    /**
     * Returns the value of the given name in this context, traversing up the context hierarchy if the value is absent in this context's view.
     *
     * @param name
     * The name to look up.
     */
    lookup(name: string): any;
  }

  let Mustache: MustacheStatic;
  export = Mustache;
}
