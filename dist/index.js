#!/usr/bin/env bun
// @bun
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/commander/lib/error.js
var require_error = __commonJS((exports) => {
  class CommanderError extends Error {
    constructor(exitCode, code, message) {
      super(message);
      Error.captureStackTrace(this, this.constructor);
      this.name = this.constructor.name;
      this.code = code;
      this.exitCode = exitCode;
      this.nestedError = undefined;
    }
  }

  class InvalidArgumentError extends CommanderError {
    constructor(message) {
      super(1, "commander.invalidArgument", message);
      Error.captureStackTrace(this, this.constructor);
      this.name = this.constructor.name;
    }
  }
  exports.CommanderError = CommanderError;
  exports.InvalidArgumentError = InvalidArgumentError;
});

// node_modules/commander/lib/argument.js
var require_argument = __commonJS((exports) => {
  var { InvalidArgumentError } = require_error();

  class Argument {
    constructor(name, description) {
      this.description = description || "";
      this.variadic = false;
      this.parseArg = undefined;
      this.defaultValue = undefined;
      this.defaultValueDescription = undefined;
      this.argChoices = undefined;
      switch (name[0]) {
        case "<":
          this.required = true;
          this._name = name.slice(1, -1);
          break;
        case "[":
          this.required = false;
          this._name = name.slice(1, -1);
          break;
        default:
          this.required = true;
          this._name = name;
          break;
      }
      if (this._name.length > 3 && this._name.slice(-3) === "...") {
        this.variadic = true;
        this._name = this._name.slice(0, -3);
      }
    }
    name() {
      return this._name;
    }
    _concatValue(value, previous) {
      if (previous === this.defaultValue || !Array.isArray(previous)) {
        return [value];
      }
      return previous.concat(value);
    }
    default(value, description) {
      this.defaultValue = value;
      this.defaultValueDescription = description;
      return this;
    }
    argParser(fn) {
      this.parseArg = fn;
      return this;
    }
    choices(values) {
      this.argChoices = values.slice();
      this.parseArg = (arg, previous) => {
        if (!this.argChoices.includes(arg)) {
          throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
        }
        if (this.variadic) {
          return this._concatValue(arg, previous);
        }
        return arg;
      };
      return this;
    }
    argRequired() {
      this.required = true;
      return this;
    }
    argOptional() {
      this.required = false;
      return this;
    }
  }
  function humanReadableArgName(arg) {
    const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
    return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
  }
  exports.Argument = Argument;
  exports.humanReadableArgName = humanReadableArgName;
});

// node_modules/commander/lib/help.js
var require_help = __commonJS((exports) => {
  var { humanReadableArgName } = require_argument();

  class Help {
    constructor() {
      this.helpWidth = undefined;
      this.sortSubcommands = false;
      this.sortOptions = false;
      this.showGlobalOptions = false;
    }
    visibleCommands(cmd) {
      const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
      const helpCommand = cmd._getHelpCommand();
      if (helpCommand && !helpCommand._hidden) {
        visibleCommands.push(helpCommand);
      }
      if (this.sortSubcommands) {
        visibleCommands.sort((a, b) => {
          return a.name().localeCompare(b.name());
        });
      }
      return visibleCommands;
    }
    compareOptions(a, b) {
      const getSortKey = (option) => {
        return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
      };
      return getSortKey(a).localeCompare(getSortKey(b));
    }
    visibleOptions(cmd) {
      const visibleOptions = cmd.options.filter((option) => !option.hidden);
      const helpOption = cmd._getHelpOption();
      if (helpOption && !helpOption.hidden) {
        const removeShort = helpOption.short && cmd._findOption(helpOption.short);
        const removeLong = helpOption.long && cmd._findOption(helpOption.long);
        if (!removeShort && !removeLong) {
          visibleOptions.push(helpOption);
        } else if (helpOption.long && !removeLong) {
          visibleOptions.push(cmd.createOption(helpOption.long, helpOption.description));
        } else if (helpOption.short && !removeShort) {
          visibleOptions.push(cmd.createOption(helpOption.short, helpOption.description));
        }
      }
      if (this.sortOptions) {
        visibleOptions.sort(this.compareOptions);
      }
      return visibleOptions;
    }
    visibleGlobalOptions(cmd) {
      if (!this.showGlobalOptions)
        return [];
      const globalOptions = [];
      for (let ancestorCmd = cmd.parent;ancestorCmd; ancestorCmd = ancestorCmd.parent) {
        const visibleOptions = ancestorCmd.options.filter((option) => !option.hidden);
        globalOptions.push(...visibleOptions);
      }
      if (this.sortOptions) {
        globalOptions.sort(this.compareOptions);
      }
      return globalOptions;
    }
    visibleArguments(cmd) {
      if (cmd._argsDescription) {
        cmd.registeredArguments.forEach((argument) => {
          argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
        });
      }
      if (cmd.registeredArguments.find((argument) => argument.description)) {
        return cmd.registeredArguments;
      }
      return [];
    }
    subcommandTerm(cmd) {
      const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
      return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + (args ? " " + args : "");
    }
    optionTerm(option) {
      return option.flags;
    }
    argumentTerm(argument) {
      return argument.name();
    }
    longestSubcommandTermLength(cmd, helper) {
      return helper.visibleCommands(cmd).reduce((max, command) => {
        return Math.max(max, helper.subcommandTerm(command).length);
      }, 0);
    }
    longestOptionTermLength(cmd, helper) {
      return helper.visibleOptions(cmd).reduce((max, option) => {
        return Math.max(max, helper.optionTerm(option).length);
      }, 0);
    }
    longestGlobalOptionTermLength(cmd, helper) {
      return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
        return Math.max(max, helper.optionTerm(option).length);
      }, 0);
    }
    longestArgumentTermLength(cmd, helper) {
      return helper.visibleArguments(cmd).reduce((max, argument) => {
        return Math.max(max, helper.argumentTerm(argument).length);
      }, 0);
    }
    commandUsage(cmd) {
      let cmdName = cmd._name;
      if (cmd._aliases[0]) {
        cmdName = cmdName + "|" + cmd._aliases[0];
      }
      let ancestorCmdNames = "";
      for (let ancestorCmd = cmd.parent;ancestorCmd; ancestorCmd = ancestorCmd.parent) {
        ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
      }
      return ancestorCmdNames + cmdName + " " + cmd.usage();
    }
    commandDescription(cmd) {
      return cmd.description();
    }
    subcommandDescription(cmd) {
      return cmd.summary() || cmd.description();
    }
    optionDescription(option) {
      const extraInfo = [];
      if (option.argChoices) {
        extraInfo.push(`choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
      }
      if (option.defaultValue !== undefined) {
        const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
        if (showDefault) {
          extraInfo.push(`default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`);
        }
      }
      if (option.presetArg !== undefined && option.optional) {
        extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
      }
      if (option.envVar !== undefined) {
        extraInfo.push(`env: ${option.envVar}`);
      }
      if (extraInfo.length > 0) {
        return `${option.description} (${extraInfo.join(", ")})`;
      }
      return option.description;
    }
    argumentDescription(argument) {
      const extraInfo = [];
      if (argument.argChoices) {
        extraInfo.push(`choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
      }
      if (argument.defaultValue !== undefined) {
        extraInfo.push(`default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`);
      }
      if (extraInfo.length > 0) {
        const extraDescripton = `(${extraInfo.join(", ")})`;
        if (argument.description) {
          return `${argument.description} ${extraDescripton}`;
        }
        return extraDescripton;
      }
      return argument.description;
    }
    formatHelp(cmd, helper) {
      const termWidth = helper.padWidth(cmd, helper);
      const helpWidth = helper.helpWidth || 80;
      const itemIndentWidth = 2;
      const itemSeparatorWidth = 2;
      function formatItem(term, description) {
        if (description) {
          const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
          return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth);
        }
        return term;
      }
      function formatList(textArray) {
        return textArray.join(`
`).replace(/^/gm, " ".repeat(itemIndentWidth));
      }
      let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
      const commandDescription = helper.commandDescription(cmd);
      if (commandDescription.length > 0) {
        output = output.concat([
          helper.wrap(commandDescription, helpWidth, 0),
          ""
        ]);
      }
      const argumentList = helper.visibleArguments(cmd).map((argument) => {
        return formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument));
      });
      if (argumentList.length > 0) {
        output = output.concat(["Arguments:", formatList(argumentList), ""]);
      }
      const optionList = helper.visibleOptions(cmd).map((option) => {
        return formatItem(helper.optionTerm(option), helper.optionDescription(option));
      });
      if (optionList.length > 0) {
        output = output.concat(["Options:", formatList(optionList), ""]);
      }
      if (this.showGlobalOptions) {
        const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
          return formatItem(helper.optionTerm(option), helper.optionDescription(option));
        });
        if (globalOptionList.length > 0) {
          output = output.concat([
            "Global Options:",
            formatList(globalOptionList),
            ""
          ]);
        }
      }
      const commandList = helper.visibleCommands(cmd).map((cmd2) => {
        return formatItem(helper.subcommandTerm(cmd2), helper.subcommandDescription(cmd2));
      });
      if (commandList.length > 0) {
        output = output.concat(["Commands:", formatList(commandList), ""]);
      }
      return output.join(`
`);
    }
    padWidth(cmd, helper) {
      return Math.max(helper.longestOptionTermLength(cmd, helper), helper.longestGlobalOptionTermLength(cmd, helper), helper.longestSubcommandTermLength(cmd, helper), helper.longestArgumentTermLength(cmd, helper));
    }
    wrap(str, width, indent, minColumnWidth = 40) {
      const indents = " \\f\\t\\v   -   　\uFEFF";
      const manualIndent = new RegExp(`[\\n][${indents}]+`);
      if (str.match(manualIndent))
        return str;
      const columnWidth = width - indent;
      if (columnWidth < minColumnWidth)
        return str;
      const leadingStr = str.slice(0, indent);
      const columnText = str.slice(indent).replace(`\r
`, `
`);
      const indentString = " ".repeat(indent);
      const zeroWidthSpace = "​";
      const breaks = `\\s${zeroWidthSpace}`;
      const regex = new RegExp(`
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`, "g");
      const lines = columnText.match(regex) || [];
      return leadingStr + lines.map((line, i) => {
        if (line === `
`)
          return "";
        return (i > 0 ? indentString : "") + line.trimEnd();
      }).join(`
`);
    }
  }
  exports.Help = Help;
});

// node_modules/commander/lib/option.js
var require_option = __commonJS((exports) => {
  var { InvalidArgumentError } = require_error();

  class Option {
    constructor(flags, description) {
      this.flags = flags;
      this.description = description || "";
      this.required = flags.includes("<");
      this.optional = flags.includes("[");
      this.variadic = /\w\.\.\.[>\]]$/.test(flags);
      this.mandatory = false;
      const optionFlags = splitOptionFlags(flags);
      this.short = optionFlags.shortFlag;
      this.long = optionFlags.longFlag;
      this.negate = false;
      if (this.long) {
        this.negate = this.long.startsWith("--no-");
      }
      this.defaultValue = undefined;
      this.defaultValueDescription = undefined;
      this.presetArg = undefined;
      this.envVar = undefined;
      this.parseArg = undefined;
      this.hidden = false;
      this.argChoices = undefined;
      this.conflictsWith = [];
      this.implied = undefined;
    }
    default(value, description) {
      this.defaultValue = value;
      this.defaultValueDescription = description;
      return this;
    }
    preset(arg) {
      this.presetArg = arg;
      return this;
    }
    conflicts(names) {
      this.conflictsWith = this.conflictsWith.concat(names);
      return this;
    }
    implies(impliedOptionValues) {
      let newImplied = impliedOptionValues;
      if (typeof impliedOptionValues === "string") {
        newImplied = { [impliedOptionValues]: true };
      }
      this.implied = Object.assign(this.implied || {}, newImplied);
      return this;
    }
    env(name) {
      this.envVar = name;
      return this;
    }
    argParser(fn) {
      this.parseArg = fn;
      return this;
    }
    makeOptionMandatory(mandatory = true) {
      this.mandatory = !!mandatory;
      return this;
    }
    hideHelp(hide = true) {
      this.hidden = !!hide;
      return this;
    }
    _concatValue(value, previous) {
      if (previous === this.defaultValue || !Array.isArray(previous)) {
        return [value];
      }
      return previous.concat(value);
    }
    choices(values) {
      this.argChoices = values.slice();
      this.parseArg = (arg, previous) => {
        if (!this.argChoices.includes(arg)) {
          throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
        }
        if (this.variadic) {
          return this._concatValue(arg, previous);
        }
        return arg;
      };
      return this;
    }
    name() {
      if (this.long) {
        return this.long.replace(/^--/, "");
      }
      return this.short.replace(/^-/, "");
    }
    attributeName() {
      return camelcase(this.name().replace(/^no-/, ""));
    }
    is(arg) {
      return this.short === arg || this.long === arg;
    }
    isBoolean() {
      return !this.required && !this.optional && !this.negate;
    }
  }

  class DualOptions {
    constructor(options) {
      this.positiveOptions = new Map;
      this.negativeOptions = new Map;
      this.dualOptions = new Set;
      options.forEach((option) => {
        if (option.negate) {
          this.negativeOptions.set(option.attributeName(), option);
        } else {
          this.positiveOptions.set(option.attributeName(), option);
        }
      });
      this.negativeOptions.forEach((value, key) => {
        if (this.positiveOptions.has(key)) {
          this.dualOptions.add(key);
        }
      });
    }
    valueFromOption(value, option) {
      const optionKey = option.attributeName();
      if (!this.dualOptions.has(optionKey))
        return true;
      const preset = this.negativeOptions.get(optionKey).presetArg;
      const negativeValue = preset !== undefined ? preset : false;
      return option.negate === (negativeValue === value);
    }
  }
  function camelcase(str) {
    return str.split("-").reduce((str2, word) => {
      return str2 + word[0].toUpperCase() + word.slice(1);
    });
  }
  function splitOptionFlags(flags) {
    let shortFlag;
    let longFlag;
    const flagParts = flags.split(/[ |,]+/);
    if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
      shortFlag = flagParts.shift();
    longFlag = flagParts.shift();
    if (!shortFlag && /^-[^-]$/.test(longFlag)) {
      shortFlag = longFlag;
      longFlag = undefined;
    }
    return { shortFlag, longFlag };
  }
  exports.Option = Option;
  exports.DualOptions = DualOptions;
});

// node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS((exports) => {
  var maxDistance = 3;
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > maxDistance)
      return Math.max(a.length, b.length);
    const d = [];
    for (let i = 0;i <= a.length; i++) {
      d[i] = [i];
    }
    for (let j = 0;j <= b.length; j++) {
      d[0][j] = j;
    }
    for (let j = 1;j <= b.length; j++) {
      for (let i = 1;i <= a.length; i++) {
        let cost = 1;
        if (a[i - 1] === b[j - 1]) {
          cost = 0;
        } else {
          cost = 1;
        }
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }
  function suggestSimilar(word, candidates) {
    if (!candidates || candidates.length === 0)
      return "";
    candidates = Array.from(new Set(candidates));
    const searchingOptions = word.startsWith("--");
    if (searchingOptions) {
      word = word.slice(2);
      candidates = candidates.map((candidate) => candidate.slice(2));
    }
    let similar = [];
    let bestDistance = maxDistance;
    const minSimilarity = 0.4;
    candidates.forEach((candidate) => {
      if (candidate.length <= 1)
        return;
      const distance = editDistance(word, candidate);
      const length = Math.max(word.length, candidate.length);
      const similarity = (length - distance) / length;
      if (similarity > minSimilarity) {
        if (distance < bestDistance) {
          bestDistance = distance;
          similar = [candidate];
        } else if (distance === bestDistance) {
          similar.push(candidate);
        }
      }
    });
    similar.sort((a, b) => a.localeCompare(b));
    if (searchingOptions) {
      similar = similar.map((candidate) => `--${candidate}`);
    }
    if (similar.length > 1) {
      return `
(Did you mean one of ${similar.join(", ")}?)`;
    }
    if (similar.length === 1) {
      return `
(Did you mean ${similar[0]}?)`;
    }
    return "";
  }
  exports.suggestSimilar = suggestSimilar;
});

// node_modules/commander/lib/command.js
var require_command = __commonJS((exports) => {
  var EventEmitter = __require("node:events").EventEmitter;
  var childProcess = __require("node:child_process");
  var path = __require("node:path");
  var fs = __require("node:fs");
  var process2 = __require("node:process");
  var { Argument, humanReadableArgName } = require_argument();
  var { CommanderError } = require_error();
  var { Help } = require_help();
  var { Option, DualOptions } = require_option();
  var { suggestSimilar } = require_suggestSimilar();

  class Command extends EventEmitter {
    constructor(name) {
      super();
      this.commands = [];
      this.options = [];
      this.parent = null;
      this._allowUnknownOption = false;
      this._allowExcessArguments = true;
      this.registeredArguments = [];
      this._args = this.registeredArguments;
      this.args = [];
      this.rawArgs = [];
      this.processedArgs = [];
      this._scriptPath = null;
      this._name = name || "";
      this._optionValues = {};
      this._optionValueSources = {};
      this._storeOptionsAsProperties = false;
      this._actionHandler = null;
      this._executableHandler = false;
      this._executableFile = null;
      this._executableDir = null;
      this._defaultCommandName = null;
      this._exitCallback = null;
      this._aliases = [];
      this._combineFlagAndOptionalValue = true;
      this._description = "";
      this._summary = "";
      this._argsDescription = undefined;
      this._enablePositionalOptions = false;
      this._passThroughOptions = false;
      this._lifeCycleHooks = {};
      this._showHelpAfterError = false;
      this._showSuggestionAfterError = true;
      this._outputConfiguration = {
        writeOut: (str) => process2.stdout.write(str),
        writeErr: (str) => process2.stderr.write(str),
        getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : undefined,
        getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : undefined,
        outputError: (str, write) => write(str)
      };
      this._hidden = false;
      this._helpOption = undefined;
      this._addImplicitHelpCommand = undefined;
      this._helpCommand = undefined;
      this._helpConfiguration = {};
    }
    copyInheritedSettings(sourceCommand) {
      this._outputConfiguration = sourceCommand._outputConfiguration;
      this._helpOption = sourceCommand._helpOption;
      this._helpCommand = sourceCommand._helpCommand;
      this._helpConfiguration = sourceCommand._helpConfiguration;
      this._exitCallback = sourceCommand._exitCallback;
      this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
      this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
      this._allowExcessArguments = sourceCommand._allowExcessArguments;
      this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
      this._showHelpAfterError = sourceCommand._showHelpAfterError;
      this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
      return this;
    }
    _getCommandAndAncestors() {
      const result = [];
      for (let command = this;command; command = command.parent) {
        result.push(command);
      }
      return result;
    }
    command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
      let desc = actionOptsOrExecDesc;
      let opts = execOpts;
      if (typeof desc === "object" && desc !== null) {
        opts = desc;
        desc = null;
      }
      opts = opts || {};
      const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
      const cmd = this.createCommand(name);
      if (desc) {
        cmd.description(desc);
        cmd._executableHandler = true;
      }
      if (opts.isDefault)
        this._defaultCommandName = cmd._name;
      cmd._hidden = !!(opts.noHelp || opts.hidden);
      cmd._executableFile = opts.executableFile || null;
      if (args)
        cmd.arguments(args);
      this._registerCommand(cmd);
      cmd.parent = this;
      cmd.copyInheritedSettings(this);
      if (desc)
        return this;
      return cmd;
    }
    createCommand(name) {
      return new Command(name);
    }
    createHelp() {
      return Object.assign(new Help, this.configureHelp());
    }
    configureHelp(configuration) {
      if (configuration === undefined)
        return this._helpConfiguration;
      this._helpConfiguration = configuration;
      return this;
    }
    configureOutput(configuration) {
      if (configuration === undefined)
        return this._outputConfiguration;
      Object.assign(this._outputConfiguration, configuration);
      return this;
    }
    showHelpAfterError(displayHelp = true) {
      if (typeof displayHelp !== "string")
        displayHelp = !!displayHelp;
      this._showHelpAfterError = displayHelp;
      return this;
    }
    showSuggestionAfterError(displaySuggestion = true) {
      this._showSuggestionAfterError = !!displaySuggestion;
      return this;
    }
    addCommand(cmd, opts) {
      if (!cmd._name) {
        throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
      }
      opts = opts || {};
      if (opts.isDefault)
        this._defaultCommandName = cmd._name;
      if (opts.noHelp || opts.hidden)
        cmd._hidden = true;
      this._registerCommand(cmd);
      cmd.parent = this;
      cmd._checkForBrokenPassThrough();
      return this;
    }
    createArgument(name, description) {
      return new Argument(name, description);
    }
    argument(name, description, fn, defaultValue) {
      const argument = this.createArgument(name, description);
      if (typeof fn === "function") {
        argument.default(defaultValue).argParser(fn);
      } else {
        argument.default(fn);
      }
      this.addArgument(argument);
      return this;
    }
    arguments(names) {
      names.trim().split(/ +/).forEach((detail) => {
        this.argument(detail);
      });
      return this;
    }
    addArgument(argument) {
      const previousArgument = this.registeredArguments.slice(-1)[0];
      if (previousArgument && previousArgument.variadic) {
        throw new Error(`only the last argument can be variadic '${previousArgument.name()}'`);
      }
      if (argument.required && argument.defaultValue !== undefined && argument.parseArg === undefined) {
        throw new Error(`a default value for a required argument is never used: '${argument.name()}'`);
      }
      this.registeredArguments.push(argument);
      return this;
    }
    helpCommand(enableOrNameAndArgs, description) {
      if (typeof enableOrNameAndArgs === "boolean") {
        this._addImplicitHelpCommand = enableOrNameAndArgs;
        return this;
      }
      enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
      const [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/);
      const helpDescription = description ?? "display help for command";
      const helpCommand = this.createCommand(helpName);
      helpCommand.helpOption(false);
      if (helpArgs)
        helpCommand.arguments(helpArgs);
      if (helpDescription)
        helpCommand.description(helpDescription);
      this._addImplicitHelpCommand = true;
      this._helpCommand = helpCommand;
      return this;
    }
    addHelpCommand(helpCommand, deprecatedDescription) {
      if (typeof helpCommand !== "object") {
        this.helpCommand(helpCommand, deprecatedDescription);
        return this;
      }
      this._addImplicitHelpCommand = true;
      this._helpCommand = helpCommand;
      return this;
    }
    _getHelpCommand() {
      const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
      if (hasImplicitHelpCommand) {
        if (this._helpCommand === undefined) {
          this.helpCommand(undefined, undefined);
        }
        return this._helpCommand;
      }
      return null;
    }
    hook(event, listener) {
      const allowedValues = ["preSubcommand", "preAction", "postAction"];
      if (!allowedValues.includes(event)) {
        throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
      }
      if (this._lifeCycleHooks[event]) {
        this._lifeCycleHooks[event].push(listener);
      } else {
        this._lifeCycleHooks[event] = [listener];
      }
      return this;
    }
    exitOverride(fn) {
      if (fn) {
        this._exitCallback = fn;
      } else {
        this._exitCallback = (err) => {
          if (err.code !== "commander.executeSubCommandAsync") {
            throw err;
          } else {}
        };
      }
      return this;
    }
    _exit(exitCode, code, message) {
      if (this._exitCallback) {
        this._exitCallback(new CommanderError(exitCode, code, message));
      }
      process2.exit(exitCode);
    }
    action(fn) {
      const listener = (args) => {
        const expectedArgsCount = this.registeredArguments.length;
        const actionArgs = args.slice(0, expectedArgsCount);
        if (this._storeOptionsAsProperties) {
          actionArgs[expectedArgsCount] = this;
        } else {
          actionArgs[expectedArgsCount] = this.opts();
        }
        actionArgs.push(this);
        return fn.apply(this, actionArgs);
      };
      this._actionHandler = listener;
      return this;
    }
    createOption(flags, description) {
      return new Option(flags, description);
    }
    _callParseArg(target, value, previous, invalidArgumentMessage) {
      try {
        return target.parseArg(value, previous);
      } catch (err) {
        if (err.code === "commander.invalidArgument") {
          const message = `${invalidArgumentMessage} ${err.message}`;
          this.error(message, { exitCode: err.exitCode, code: err.code });
        }
        throw err;
      }
    }
    _registerOption(option) {
      const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
      if (matchingOption) {
        const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
        throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
      }
      this.options.push(option);
    }
    _registerCommand(command) {
      const knownBy = (cmd) => {
        return [cmd.name()].concat(cmd.aliases());
      };
      const alreadyUsed = knownBy(command).find((name) => this._findCommand(name));
      if (alreadyUsed) {
        const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
        const newCmd = knownBy(command).join("|");
        throw new Error(`cannot add command '${newCmd}' as already have command '${existingCmd}'`);
      }
      this.commands.push(command);
    }
    addOption(option) {
      this._registerOption(option);
      const oname = option.name();
      const name = option.attributeName();
      if (option.negate) {
        const positiveLongFlag = option.long.replace(/^--no-/, "--");
        if (!this._findOption(positiveLongFlag)) {
          this.setOptionValueWithSource(name, option.defaultValue === undefined ? true : option.defaultValue, "default");
        }
      } else if (option.defaultValue !== undefined) {
        this.setOptionValueWithSource(name, option.defaultValue, "default");
      }
      const handleOptionValue = (val, invalidValueMessage, valueSource) => {
        if (val == null && option.presetArg !== undefined) {
          val = option.presetArg;
        }
        const oldValue = this.getOptionValue(name);
        if (val !== null && option.parseArg) {
          val = this._callParseArg(option, val, oldValue, invalidValueMessage);
        } else if (val !== null && option.variadic) {
          val = option._concatValue(val, oldValue);
        }
        if (val == null) {
          if (option.negate) {
            val = false;
          } else if (option.isBoolean() || option.optional) {
            val = true;
          } else {
            val = "";
          }
        }
        this.setOptionValueWithSource(name, val, valueSource);
      };
      this.on("option:" + oname, (val) => {
        const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
        handleOptionValue(val, invalidValueMessage, "cli");
      });
      if (option.envVar) {
        this.on("optionEnv:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "env");
        });
      }
      return this;
    }
    _optionEx(config, flags, description, fn, defaultValue) {
      if (typeof flags === "object" && flags instanceof Option) {
        throw new Error("To add an Option object use addOption() instead of option() or requiredOption()");
      }
      const option = this.createOption(flags, description);
      option.makeOptionMandatory(!!config.mandatory);
      if (typeof fn === "function") {
        option.default(defaultValue).argParser(fn);
      } else if (fn instanceof RegExp) {
        const regex = fn;
        fn = (val, def) => {
          const m = regex.exec(val);
          return m ? m[0] : def;
        };
        option.default(defaultValue).argParser(fn);
      } else {
        option.default(fn);
      }
      return this.addOption(option);
    }
    option(flags, description, parseArg, defaultValue) {
      return this._optionEx({}, flags, description, parseArg, defaultValue);
    }
    requiredOption(flags, description, parseArg, defaultValue) {
      return this._optionEx({ mandatory: true }, flags, description, parseArg, defaultValue);
    }
    combineFlagAndOptionalValue(combine = true) {
      this._combineFlagAndOptionalValue = !!combine;
      return this;
    }
    allowUnknownOption(allowUnknown = true) {
      this._allowUnknownOption = !!allowUnknown;
      return this;
    }
    allowExcessArguments(allowExcess = true) {
      this._allowExcessArguments = !!allowExcess;
      return this;
    }
    enablePositionalOptions(positional = true) {
      this._enablePositionalOptions = !!positional;
      return this;
    }
    passThroughOptions(passThrough = true) {
      this._passThroughOptions = !!passThrough;
      this._checkForBrokenPassThrough();
      return this;
    }
    _checkForBrokenPassThrough() {
      if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
        throw new Error(`passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`);
      }
    }
    storeOptionsAsProperties(storeAsProperties = true) {
      if (this.options.length) {
        throw new Error("call .storeOptionsAsProperties() before adding options");
      }
      if (Object.keys(this._optionValues).length) {
        throw new Error("call .storeOptionsAsProperties() before setting option values");
      }
      this._storeOptionsAsProperties = !!storeAsProperties;
      return this;
    }
    getOptionValue(key) {
      if (this._storeOptionsAsProperties) {
        return this[key];
      }
      return this._optionValues[key];
    }
    setOptionValue(key, value) {
      return this.setOptionValueWithSource(key, value, undefined);
    }
    setOptionValueWithSource(key, value, source) {
      if (this._storeOptionsAsProperties) {
        this[key] = value;
      } else {
        this._optionValues[key] = value;
      }
      this._optionValueSources[key] = source;
      return this;
    }
    getOptionValueSource(key) {
      return this._optionValueSources[key];
    }
    getOptionValueSourceWithGlobals(key) {
      let source;
      this._getCommandAndAncestors().forEach((cmd) => {
        if (cmd.getOptionValueSource(key) !== undefined) {
          source = cmd.getOptionValueSource(key);
        }
      });
      return source;
    }
    _prepareUserArgs(argv, parseOptions) {
      if (argv !== undefined && !Array.isArray(argv)) {
        throw new Error("first parameter to parse must be array or undefined");
      }
      parseOptions = parseOptions || {};
      if (argv === undefined && parseOptions.from === undefined) {
        if (process2.versions?.electron) {
          parseOptions.from = "electron";
        }
        const execArgv = process2.execArgv ?? [];
        if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
          parseOptions.from = "eval";
        }
      }
      if (argv === undefined) {
        argv = process2.argv;
      }
      this.rawArgs = argv.slice();
      let userArgs;
      switch (parseOptions.from) {
        case undefined:
        case "node":
          this._scriptPath = argv[1];
          userArgs = argv.slice(2);
          break;
        case "electron":
          if (process2.defaultApp) {
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
          } else {
            userArgs = argv.slice(1);
          }
          break;
        case "user":
          userArgs = argv.slice(0);
          break;
        case "eval":
          userArgs = argv.slice(1);
          break;
        default:
          throw new Error(`unexpected parse option { from: '${parseOptions.from}' }`);
      }
      if (!this._name && this._scriptPath)
        this.nameFromFilename(this._scriptPath);
      this._name = this._name || "program";
      return userArgs;
    }
    parse(argv, parseOptions) {
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      this._parseCommand([], userArgs);
      return this;
    }
    async parseAsync(argv, parseOptions) {
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      await this._parseCommand([], userArgs);
      return this;
    }
    _executeSubCommand(subcommand, args) {
      args = args.slice();
      let launchWithNode = false;
      const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
      function findFile(baseDir, baseName) {
        const localBin = path.resolve(baseDir, baseName);
        if (fs.existsSync(localBin))
          return localBin;
        if (sourceExt.includes(path.extname(baseName)))
          return;
        const foundExt = sourceExt.find((ext) => fs.existsSync(`${localBin}${ext}`));
        if (foundExt)
          return `${localBin}${foundExt}`;
        return;
      }
      this._checkForMissingMandatoryOptions();
      this._checkForConflictingOptions();
      let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
      let executableDir = this._executableDir || "";
      if (this._scriptPath) {
        let resolvedScriptPath;
        try {
          resolvedScriptPath = fs.realpathSync(this._scriptPath);
        } catch (err) {
          resolvedScriptPath = this._scriptPath;
        }
        executableDir = path.resolve(path.dirname(resolvedScriptPath), executableDir);
      }
      if (executableDir) {
        let localFile = findFile(executableDir, executableFile);
        if (!localFile && !subcommand._executableFile && this._scriptPath) {
          const legacyName = path.basename(this._scriptPath, path.extname(this._scriptPath));
          if (legacyName !== this._name) {
            localFile = findFile(executableDir, `${legacyName}-${subcommand._name}`);
          }
        }
        executableFile = localFile || executableFile;
      }
      launchWithNode = sourceExt.includes(path.extname(executableFile));
      let proc;
      if (process2.platform !== "win32") {
        if (launchWithNode) {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
        } else {
          proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
        }
      } else {
        args.unshift(executableFile);
        args = incrementNodeInspectorPort(process2.execArgv).concat(args);
        proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
      }
      if (!proc.killed) {
        const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
        signals.forEach((signal) => {
          process2.on(signal, () => {
            if (proc.killed === false && proc.exitCode === null) {
              proc.kill(signal);
            }
          });
        });
      }
      const exitCallback = this._exitCallback;
      proc.on("close", (code) => {
        code = code ?? 1;
        if (!exitCallback) {
          process2.exit(code);
        } else {
          exitCallback(new CommanderError(code, "commander.executeSubCommandAsync", "(close)"));
        }
      });
      proc.on("error", (err) => {
        if (err.code === "ENOENT") {
          const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
          const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
          throw new Error(executableMissing);
        } else if (err.code === "EACCES") {
          throw new Error(`'${executableFile}' not executable`);
        }
        if (!exitCallback) {
          process2.exit(1);
        } else {
          const wrappedError = new CommanderError(1, "commander.executeSubCommandAsync", "(error)");
          wrappedError.nestedError = err;
          exitCallback(wrappedError);
        }
      });
      this.runningCommand = proc;
    }
    _dispatchSubcommand(commandName, operands, unknown) {
      const subCommand = this._findCommand(commandName);
      if (!subCommand)
        this.help({ error: true });
      let promiseChain;
      promiseChain = this._chainOrCallSubCommandHook(promiseChain, subCommand, "preSubcommand");
      promiseChain = this._chainOrCall(promiseChain, () => {
        if (subCommand._executableHandler) {
          this._executeSubCommand(subCommand, operands.concat(unknown));
        } else {
          return subCommand._parseCommand(operands, unknown);
        }
      });
      return promiseChain;
    }
    _dispatchHelpCommand(subcommandName) {
      if (!subcommandName) {
        this.help();
      }
      const subCommand = this._findCommand(subcommandName);
      if (subCommand && !subCommand._executableHandler) {
        subCommand.help();
      }
      return this._dispatchSubcommand(subcommandName, [], [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]);
    }
    _checkNumberOfArguments() {
      this.registeredArguments.forEach((arg, i) => {
        if (arg.required && this.args[i] == null) {
          this.missingArgument(arg.name());
        }
      });
      if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
        return;
      }
      if (this.args.length > this.registeredArguments.length) {
        this._excessArguments(this.args);
      }
    }
    _processArguments() {
      const myParseArg = (argument, value, previous) => {
        let parsedValue = value;
        if (value !== null && argument.parseArg) {
          const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
          parsedValue = this._callParseArg(argument, value, previous, invalidValueMessage);
        }
        return parsedValue;
      };
      this._checkNumberOfArguments();
      const processedArgs = [];
      this.registeredArguments.forEach((declaredArg, index) => {
        let value = declaredArg.defaultValue;
        if (declaredArg.variadic) {
          if (index < this.args.length) {
            value = this.args.slice(index);
            if (declaredArg.parseArg) {
              value = value.reduce((processed, v) => {
                return myParseArg(declaredArg, v, processed);
              }, declaredArg.defaultValue);
            }
          } else if (value === undefined) {
            value = [];
          }
        } else if (index < this.args.length) {
          value = this.args[index];
          if (declaredArg.parseArg) {
            value = myParseArg(declaredArg, value, declaredArg.defaultValue);
          }
        }
        processedArgs[index] = value;
      });
      this.processedArgs = processedArgs;
    }
    _chainOrCall(promise, fn) {
      if (promise && promise.then && typeof promise.then === "function") {
        return promise.then(() => fn());
      }
      return fn();
    }
    _chainOrCallHooks(promise, event) {
      let result = promise;
      const hooks = [];
      this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== undefined).forEach((hookedCommand) => {
        hookedCommand._lifeCycleHooks[event].forEach((callback) => {
          hooks.push({ hookedCommand, callback });
        });
      });
      if (event === "postAction") {
        hooks.reverse();
      }
      hooks.forEach((hookDetail) => {
        result = this._chainOrCall(result, () => {
          return hookDetail.callback(hookDetail.hookedCommand, this);
        });
      });
      return result;
    }
    _chainOrCallSubCommandHook(promise, subCommand, event) {
      let result = promise;
      if (this._lifeCycleHooks[event] !== undefined) {
        this._lifeCycleHooks[event].forEach((hook) => {
          result = this._chainOrCall(result, () => {
            return hook(this, subCommand);
          });
        });
      }
      return result;
    }
    _parseCommand(operands, unknown) {
      const parsed = this.parseOptions(unknown);
      this._parseOptionsEnv();
      this._parseOptionsImplied();
      operands = operands.concat(parsed.operands);
      unknown = parsed.unknown;
      this.args = operands.concat(unknown);
      if (operands && this._findCommand(operands[0])) {
        return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
      }
      if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
        return this._dispatchHelpCommand(operands[1]);
      }
      if (this._defaultCommandName) {
        this._outputHelpIfRequested(unknown);
        return this._dispatchSubcommand(this._defaultCommandName, operands, unknown);
      }
      if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
        this.help({ error: true });
      }
      this._outputHelpIfRequested(parsed.unknown);
      this._checkForMissingMandatoryOptions();
      this._checkForConflictingOptions();
      const checkForUnknownOptions = () => {
        if (parsed.unknown.length > 0) {
          this.unknownOption(parsed.unknown[0]);
        }
      };
      const commandEvent = `command:${this.name()}`;
      if (this._actionHandler) {
        checkForUnknownOptions();
        this._processArguments();
        let promiseChain;
        promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
        promiseChain = this._chainOrCall(promiseChain, () => this._actionHandler(this.processedArgs));
        if (this.parent) {
          promiseChain = this._chainOrCall(promiseChain, () => {
            this.parent.emit(commandEvent, operands, unknown);
          });
        }
        promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
        return promiseChain;
      }
      if (this.parent && this.parent.listenerCount(commandEvent)) {
        checkForUnknownOptions();
        this._processArguments();
        this.parent.emit(commandEvent, operands, unknown);
      } else if (operands.length) {
        if (this._findCommand("*")) {
          return this._dispatchSubcommand("*", operands, unknown);
        }
        if (this.listenerCount("command:*")) {
          this.emit("command:*", operands, unknown);
        } else if (this.commands.length) {
          this.unknownCommand();
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      } else if (this.commands.length) {
        checkForUnknownOptions();
        this.help({ error: true });
      } else {
        checkForUnknownOptions();
        this._processArguments();
      }
    }
    _findCommand(name) {
      if (!name)
        return;
      return this.commands.find((cmd) => cmd._name === name || cmd._aliases.includes(name));
    }
    _findOption(arg) {
      return this.options.find((option) => option.is(arg));
    }
    _checkForMissingMandatoryOptions() {
      this._getCommandAndAncestors().forEach((cmd) => {
        cmd.options.forEach((anOption) => {
          if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === undefined) {
            cmd.missingMandatoryOptionValue(anOption);
          }
        });
      });
    }
    _checkForConflictingLocalOptions() {
      const definedNonDefaultOptions = this.options.filter((option) => {
        const optionKey = option.attributeName();
        if (this.getOptionValue(optionKey) === undefined) {
          return false;
        }
        return this.getOptionValueSource(optionKey) !== "default";
      });
      const optionsWithConflicting = definedNonDefaultOptions.filter((option) => option.conflictsWith.length > 0);
      optionsWithConflicting.forEach((option) => {
        const conflictingAndDefined = definedNonDefaultOptions.find((defined) => option.conflictsWith.includes(defined.attributeName()));
        if (conflictingAndDefined) {
          this._conflictingOption(option, conflictingAndDefined);
        }
      });
    }
    _checkForConflictingOptions() {
      this._getCommandAndAncestors().forEach((cmd) => {
        cmd._checkForConflictingLocalOptions();
      });
    }
    parseOptions(argv) {
      const operands = [];
      const unknown = [];
      let dest = operands;
      const args = argv.slice();
      function maybeOption(arg) {
        return arg.length > 1 && arg[0] === "-";
      }
      let activeVariadicOption = null;
      while (args.length) {
        const arg = args.shift();
        if (arg === "--") {
          if (dest === unknown)
            dest.push(arg);
          dest.push(...args);
          break;
        }
        if (activeVariadicOption && !maybeOption(arg)) {
          this.emit(`option:${activeVariadicOption.name()}`, arg);
          continue;
        }
        activeVariadicOption = null;
        if (maybeOption(arg)) {
          const option = this._findOption(arg);
          if (option) {
            if (option.required) {
              const value = args.shift();
              if (value === undefined)
                this.optionMissingArgument(option);
              this.emit(`option:${option.name()}`, value);
            } else if (option.optional) {
              let value = null;
              if (args.length > 0 && !maybeOption(args[0])) {
                value = args.shift();
              }
              this.emit(`option:${option.name()}`, value);
            } else {
              this.emit(`option:${option.name()}`);
            }
            activeVariadicOption = option.variadic ? option : null;
            continue;
          }
        }
        if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
          const option = this._findOption(`-${arg[1]}`);
          if (option) {
            if (option.required || option.optional && this._combineFlagAndOptionalValue) {
              this.emit(`option:${option.name()}`, arg.slice(2));
            } else {
              this.emit(`option:${option.name()}`);
              args.unshift(`-${arg.slice(2)}`);
            }
            continue;
          }
        }
        if (/^--[^=]+=/.test(arg)) {
          const index = arg.indexOf("=");
          const option = this._findOption(arg.slice(0, index));
          if (option && (option.required || option.optional)) {
            this.emit(`option:${option.name()}`, arg.slice(index + 1));
            continue;
          }
        }
        if (maybeOption(arg)) {
          dest = unknown;
        }
        if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
          if (this._findCommand(arg)) {
            operands.push(arg);
            if (args.length > 0)
              unknown.push(...args);
            break;
          } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
            operands.push(arg);
            if (args.length > 0)
              operands.push(...args);
            break;
          } else if (this._defaultCommandName) {
            unknown.push(arg);
            if (args.length > 0)
              unknown.push(...args);
            break;
          }
        }
        if (this._passThroughOptions) {
          dest.push(arg);
          if (args.length > 0)
            dest.push(...args);
          break;
        }
        dest.push(arg);
      }
      return { operands, unknown };
    }
    opts() {
      if (this._storeOptionsAsProperties) {
        const result = {};
        const len = this.options.length;
        for (let i = 0;i < len; i++) {
          const key = this.options[i].attributeName();
          result[key] = key === this._versionOptionName ? this._version : this[key];
        }
        return result;
      }
      return this._optionValues;
    }
    optsWithGlobals() {
      return this._getCommandAndAncestors().reduce((combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()), {});
    }
    error(message, errorOptions) {
      this._outputConfiguration.outputError(`${message}
`, this._outputConfiguration.writeErr);
      if (typeof this._showHelpAfterError === "string") {
        this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
      } else if (this._showHelpAfterError) {
        this._outputConfiguration.writeErr(`
`);
        this.outputHelp({ error: true });
      }
      const config = errorOptions || {};
      const exitCode = config.exitCode || 1;
      const code = config.code || "commander.error";
      this._exit(exitCode, code, message);
    }
    _parseOptionsEnv() {
      this.options.forEach((option) => {
        if (option.envVar && option.envVar in process2.env) {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === undefined || ["default", "config", "env"].includes(this.getOptionValueSource(optionKey))) {
            if (option.required || option.optional) {
              this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
            } else {
              this.emit(`optionEnv:${option.name()}`);
            }
          }
        }
      });
    }
    _parseOptionsImplied() {
      const dualHelper = new DualOptions(this.options);
      const hasCustomOptionValue = (optionKey) => {
        return this.getOptionValue(optionKey) !== undefined && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
      };
      this.options.filter((option) => option.implied !== undefined && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(this.getOptionValue(option.attributeName()), option)).forEach((option) => {
        Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
          this.setOptionValueWithSource(impliedKey, option.implied[impliedKey], "implied");
        });
      });
    }
    missingArgument(name) {
      const message = `error: missing required argument '${name}'`;
      this.error(message, { code: "commander.missingArgument" });
    }
    optionMissingArgument(option) {
      const message = `error: option '${option.flags}' argument missing`;
      this.error(message, { code: "commander.optionMissingArgument" });
    }
    missingMandatoryOptionValue(option) {
      const message = `error: required option '${option.flags}' not specified`;
      this.error(message, { code: "commander.missingMandatoryOptionValue" });
    }
    _conflictingOption(option, conflictingOption) {
      const findBestOptionFromValue = (option2) => {
        const optionKey = option2.attributeName();
        const optionValue = this.getOptionValue(optionKey);
        const negativeOption = this.options.find((target) => target.negate && optionKey === target.attributeName());
        const positiveOption = this.options.find((target) => !target.negate && optionKey === target.attributeName());
        if (negativeOption && (negativeOption.presetArg === undefined && optionValue === false || negativeOption.presetArg !== undefined && optionValue === negativeOption.presetArg)) {
          return negativeOption;
        }
        return positiveOption || option2;
      };
      const getErrorMessage = (option2) => {
        const bestOption = findBestOptionFromValue(option2);
        const optionKey = bestOption.attributeName();
        const source = this.getOptionValueSource(optionKey);
        if (source === "env") {
          return `environment variable '${bestOption.envVar}'`;
        }
        return `option '${bestOption.flags}'`;
      };
      const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
      this.error(message, { code: "commander.conflictingOption" });
    }
    unknownOption(flag) {
      if (this._allowUnknownOption)
        return;
      let suggestion = "";
      if (flag.startsWith("--") && this._showSuggestionAfterError) {
        let candidateFlags = [];
        let command = this;
        do {
          const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
          candidateFlags = candidateFlags.concat(moreFlags);
          command = command.parent;
        } while (command && !command._enablePositionalOptions);
        suggestion = suggestSimilar(flag, candidateFlags);
      }
      const message = `error: unknown option '${flag}'${suggestion}`;
      this.error(message, { code: "commander.unknownOption" });
    }
    _excessArguments(receivedArgs) {
      if (this._allowExcessArguments)
        return;
      const expected = this.registeredArguments.length;
      const s = expected === 1 ? "" : "s";
      const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
      const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
      this.error(message, { code: "commander.excessArguments" });
    }
    unknownCommand() {
      const unknownName = this.args[0];
      let suggestion = "";
      if (this._showSuggestionAfterError) {
        const candidateNames = [];
        this.createHelp().visibleCommands(this).forEach((command) => {
          candidateNames.push(command.name());
          if (command.alias())
            candidateNames.push(command.alias());
        });
        suggestion = suggestSimilar(unknownName, candidateNames);
      }
      const message = `error: unknown command '${unknownName}'${suggestion}`;
      this.error(message, { code: "commander.unknownCommand" });
    }
    version(str, flags, description) {
      if (str === undefined)
        return this._version;
      this._version = str;
      flags = flags || "-V, --version";
      description = description || "output the version number";
      const versionOption = this.createOption(flags, description);
      this._versionOptionName = versionOption.attributeName();
      this._registerOption(versionOption);
      this.on("option:" + versionOption.name(), () => {
        this._outputConfiguration.writeOut(`${str}
`);
        this._exit(0, "commander.version", str);
      });
      return this;
    }
    description(str, argsDescription) {
      if (str === undefined && argsDescription === undefined)
        return this._description;
      this._description = str;
      if (argsDescription) {
        this._argsDescription = argsDescription;
      }
      return this;
    }
    summary(str) {
      if (str === undefined)
        return this._summary;
      this._summary = str;
      return this;
    }
    alias(alias) {
      if (alias === undefined)
        return this._aliases[0];
      let command = this;
      if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
        command = this.commands[this.commands.length - 1];
      }
      if (alias === command._name)
        throw new Error("Command alias can't be the same as its name");
      const matchingCommand = this.parent?._findCommand(alias);
      if (matchingCommand) {
        const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
        throw new Error(`cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`);
      }
      command._aliases.push(alias);
      return this;
    }
    aliases(aliases) {
      if (aliases === undefined)
        return this._aliases;
      aliases.forEach((alias) => this.alias(alias));
      return this;
    }
    usage(str) {
      if (str === undefined) {
        if (this._usage)
          return this._usage;
        const args = this.registeredArguments.map((arg) => {
          return humanReadableArgName(arg);
        });
        return [].concat(this.options.length || this._helpOption !== null ? "[options]" : [], this.commands.length ? "[command]" : [], this.registeredArguments.length ? args : []).join(" ");
      }
      this._usage = str;
      return this;
    }
    name(str) {
      if (str === undefined)
        return this._name;
      this._name = str;
      return this;
    }
    nameFromFilename(filename) {
      this._name = path.basename(filename, path.extname(filename));
      return this;
    }
    executableDir(path2) {
      if (path2 === undefined)
        return this._executableDir;
      this._executableDir = path2;
      return this;
    }
    helpInformation(contextOptions) {
      const helper = this.createHelp();
      if (helper.helpWidth === undefined) {
        helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
      }
      return helper.formatHelp(this, helper);
    }
    _getHelpContext(contextOptions) {
      contextOptions = contextOptions || {};
      const context = { error: !!contextOptions.error };
      let write;
      if (context.error) {
        write = (arg) => this._outputConfiguration.writeErr(arg);
      } else {
        write = (arg) => this._outputConfiguration.writeOut(arg);
      }
      context.write = contextOptions.write || write;
      context.command = this;
      return context;
    }
    outputHelp(contextOptions) {
      let deprecatedCallback;
      if (typeof contextOptions === "function") {
        deprecatedCallback = contextOptions;
        contextOptions = undefined;
      }
      const context = this._getHelpContext(contextOptions);
      this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context));
      this.emit("beforeHelp", context);
      let helpInformation = this.helpInformation(context);
      if (deprecatedCallback) {
        helpInformation = deprecatedCallback(helpInformation);
        if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
          throw new Error("outputHelp callback must return a string or a Buffer");
        }
      }
      context.write(helpInformation);
      if (this._getHelpOption()?.long) {
        this.emit(this._getHelpOption().long);
      }
      this.emit("afterHelp", context);
      this._getCommandAndAncestors().forEach((command) => command.emit("afterAllHelp", context));
    }
    helpOption(flags, description) {
      if (typeof flags === "boolean") {
        if (flags) {
          this._helpOption = this._helpOption ?? undefined;
        } else {
          this._helpOption = null;
        }
        return this;
      }
      flags = flags ?? "-h, --help";
      description = description ?? "display help for command";
      this._helpOption = this.createOption(flags, description);
      return this;
    }
    _getHelpOption() {
      if (this._helpOption === undefined) {
        this.helpOption(undefined, undefined);
      }
      return this._helpOption;
    }
    addHelpOption(option) {
      this._helpOption = option;
      return this;
    }
    help(contextOptions) {
      this.outputHelp(contextOptions);
      let exitCode = process2.exitCode || 0;
      if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
        exitCode = 1;
      }
      this._exit(exitCode, "commander.help", "(outputHelp)");
    }
    addHelpText(position, text) {
      const allowedValues = ["beforeAll", "before", "after", "afterAll"];
      if (!allowedValues.includes(position)) {
        throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
      }
      const helpEvent = `${position}Help`;
      this.on(helpEvent, (context) => {
        let helpStr;
        if (typeof text === "function") {
          helpStr = text({ error: context.error, command: context.command });
        } else {
          helpStr = text;
        }
        if (helpStr) {
          context.write(`${helpStr}
`);
        }
      });
      return this;
    }
    _outputHelpIfRequested(args) {
      const helpOption = this._getHelpOption();
      const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
      if (helpRequested) {
        this.outputHelp();
        this._exit(0, "commander.helpDisplayed", "(outputHelp)");
      }
    }
  }
  function incrementNodeInspectorPort(args) {
    return args.map((arg) => {
      if (!arg.startsWith("--inspect")) {
        return arg;
      }
      let debugOption;
      let debugHost = "127.0.0.1";
      let debugPort = "9229";
      let match;
      if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
        debugOption = match[1];
      } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
        debugOption = match[1];
        if (/^\d+$/.test(match[3])) {
          debugPort = match[3];
        } else {
          debugHost = match[3];
        }
      } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
        debugOption = match[1];
        debugHost = match[3];
        debugPort = match[4];
      }
      if (debugOption && debugPort !== "0") {
        return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
      }
      return arg;
    });
  }
  exports.Command = Command;
});

// node_modules/commander/index.js
var require_commander = __commonJS((exports) => {
  var { Argument } = require_argument();
  var { Command } = require_command();
  var { CommanderError, InvalidArgumentError } = require_error();
  var { Help } = require_help();
  var { Option } = require_option();
  exports.program = new Command;
  exports.createCommand = (name) => new Command(name);
  exports.createOption = (flags, description) => new Option(flags, description);
  exports.createArgument = (name, description) => new Argument(name, description);
  exports.Command = Command;
  exports.Option = Option;
  exports.Argument = Argument;
  exports.Help = Help;
  exports.CommanderError = CommanderError;
  exports.InvalidArgumentError = InvalidArgumentError;
  exports.InvalidOptionArgumentError = InvalidArgumentError;
});

// node_modules/commander/esm.mjs
var import__ = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  Command,
  Argument,
  Option,
  Help
} = import__.default;

// src/index.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, readdirSync, writeFileSync as writeFileSync3, mkdirSync as mkdirSync3 } from "fs";
import { join as join5, basename } from "path";

// src/utils/config.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// src/types.ts
var DOMAIN_LIFECYCLES = {
  handoff: { ttlDays: 2, decayRate: 0, decayAfterDays: 0, autoExpire: true, maxPerDomain: 5 },
  watch: { ttlDays: 7, decayRate: 0.03, decayAfterDays: 0, autoExpire: true, maxPerDomain: 30 },
  project: { ttlDays: null, decayRate: 0.01, decayAfterDays: 14, autoExpire: false, maxPerDomain: 50 },
  stakeholder: { ttlDays: null, decayRate: 0, decayAfterDays: 0, autoExpire: false, maxPerDomain: 30 },
  rule: { ttlDays: null, decayRate: 0, decayAfterDays: 0, autoExpire: false, maxPerDomain: 50 },
  pattern: { ttlDays: null, decayRate: 0.005, decayAfterDays: 30, autoExpire: false, maxPerDomain: 50 },
  infra: { ttlDays: null, decayRate: 0.01, decayAfterDays: 14, autoExpire: false, maxPerDomain: 50 },
  skill: { ttlDays: null, decayRate: 0, decayAfterDays: 0, autoExpire: false, maxPerDomain: 30 }
};
var DEFAULT_CONFIG = {
  dataDir: ".memorai"
};

// src/utils/config.ts
var cachedConfig = null;
var configPath = null;
function getConfigPath(projectDir) {
  if (configPath)
    return configPath;
  const baseDir = projectDir || process.cwd();
  configPath = join(baseDir, ".memorai", "config.json");
  return configPath;
}
function getDataDir(projectDir) {
  const baseDir = projectDir || process.cwd();
  return join(baseDir, ".memorai");
}
function loadConfig(projectDir) {
  if (cachedConfig)
    return cachedConfig;
  const path = getConfigPath(projectDir);
  let config;
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, "utf-8");
      config = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  } else {
    config = { ...DEFAULT_CONFIG };
  }
  config.dataDir = getDataDir(projectDir);
  cachedConfig = config;
  return config;
}
function ensureDataDir(projectDir) {
  const dataDir = getDataDir(projectDir);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// src/storage/sqlite.ts
import { Database } from "bun:sqlite";
import { join as join3 } from "path";

// src/utils/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { join as join2, dirname as dirname2 } from "path";
function getDataDir2(projectDir) {
  const baseDir = projectDir || process.cwd();
  return join2(baseDir, ".memorai");
}
function ensureDataDir2(projectDir) {
  const dataDir = getDataDir2(projectDir);
  if (!existsSync2(dataDir)) {
    mkdirSync2(dataDir, { recursive: true });
  }
  return dataDir;
}

// src/storage/sqlite.ts
var db = null;
function getDatabase(projectDir) {
  if (db)
    return db;
  const dataDir = ensureDataDir2(projectDir);
  const dbPath = join3(dataDir, "memory.db");
  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  initializeSchema(db);
  return db;
}
function isV1Schema(database) {
  try {
    const row = database.query("SELECT COUNT(*) as cnt FROM pragma_table_info('beliefs') WHERE name = 'evidence_ids'").get();
    return row !== null && row.cnt > 0;
  } catch {
    return false;
  }
}
function isV2Schema(database) {
  try {
    const row = database.query("SELECT COUNT(*) as cnt FROM pragma_table_info('beliefs') WHERE name = 'belief_type'").get();
    return row !== null && row.cnt > 0;
  } catch {
    return false;
  }
}
function migrateV1toV2(database) {
  database.exec("BEGIN TRANSACTION");
  try {
    database.exec(`
      CREATE TABLE beliefs_v2 (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL CHECK(length(text) <= 500),
        domain TEXT NOT NULL CHECK(domain IN (
          'handoff','watch','project','stakeholder','rule','pattern','infra','skill'
        )),
        belief_type TEXT NOT NULL DEFAULT 'fact' CHECK(belief_type IN (
          'directive','fact','handoff','watch','decision','pending'
        )),
        confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
        importance INTEGER NOT NULL DEFAULT 3 CHECK(importance >= 1 AND importance <= 5),
        tags TEXT,

        project TEXT,
        stakeholder TEXT,
        verify_by INTEGER,
        expires_at INTEGER,
        action TEXT,
        source_session INTEGER,

        derived_at INTEGER NOT NULL,
        last_evaluated INTEGER NOT NULL,
        supersedes_id TEXT REFERENCES beliefs(id),
        invalidated_at INTEGER,
        invalidation_reason TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);
    const oldRows = database.query("SELECT id, text, domain, confidence, derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, importance, tags, created_at FROM beliefs").all();
    const insert = database.prepare(`
      INSERT INTO beliefs_v2 (
        id, text, domain, belief_type, confidence, importance, tags,
        derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of oldRows) {
      const { newDomain, newType } = reclassify(row.domain, row.text);
      const clampedImportance = Math.max(1, Math.min(5, row.importance ?? 3));
      const truncatedText = row.text.length > 500 ? row.text.slice(0, 497) + "..." : row.text;
      insert.run(row.id, truncatedText, newDomain, newType, row.confidence, clampedImportance, row.tags, row.derived_at, row.last_evaluated, row.supersedes_id, row.invalidated_at, row.invalidation_reason, row.created_at);
    }
    database.exec("DROP TRIGGER IF EXISTS beliefs_ai");
    database.exec("DROP TRIGGER IF EXISTS beliefs_ad");
    database.exec("DROP TRIGGER IF EXISTS beliefs_au");
    database.exec("DROP TRIGGER IF EXISTS events_ai");
    database.exec("DROP TRIGGER IF EXISTS events_ad");
    database.exec("DROP TRIGGER IF EXISTS events_au");
    database.exec("DROP TABLE IF EXISTS beliefs_fts");
    database.exec("DROP TABLE IF EXISTS events_fts");
    database.exec("DROP TABLE IF EXISTS predictions");
    database.exec("DROP TABLE IF EXISTS sessions");
    database.exec("DROP TABLE IF EXISTS events");
    database.exec("ALTER TABLE beliefs RENAME TO beliefs_legacy");
    database.exec("ALTER TABLE beliefs_v2 RENAME TO beliefs");
    database.exec("COMMIT");
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
}
function reclassify(oldDomain, text) {
  const upper = text.toUpperCase();
  switch (oldDomain) {
    case "constraint": {
      const isDirective = /\b(NEVER|MUST|ALWAYS)\b/.test(upper);
      return { newDomain: "rule", newType: isDirective ? "directive" : "fact" };
    }
    case "workflow": {
      if (/HANDOFF/i.test(text)) {
        return { newDomain: "handoff", newType: "handoff" };
      }
      return { newDomain: "pattern", newType: "fact" };
    }
    case "decision":
      return { newDomain: "pattern", newType: "decision" };
    case "project_structure":
      return { newDomain: "infra", newType: "fact" };
    case "code_pattern":
      return { newDomain: "pattern", newType: "fact" };
    case "user_preference":
      return { newDomain: "rule", newType: "fact" };
    default: {
      const validDomains = ["handoff", "watch", "project", "stakeholder", "rule", "pattern", "infra", "skill"];
      if (validDomains.includes(oldDomain)) {
        return { newDomain: oldDomain, newType: inferType(text) };
      }
      return { newDomain: "pattern", newType: "fact" };
    }
  }
}
function inferType(text) {
  const upper = text.toUpperCase();
  if (/\b(NEVER|MUST|ALWAYS|SHALL NOT|REQUIRED)\b/.test(upper))
    return "directive";
  if (/\bHANDOFF\b/i.test(text))
    return "handoff";
  if (/\bWATCH\b/i.test(text))
    return "watch";
  if (/\bPENDING\b/i.test(text))
    return "pending";
  return "fact";
}
function createV2Schema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS beliefs (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL CHECK(length(text) <= 500),
      domain TEXT NOT NULL CHECK(domain IN (
        'handoff','watch','project','stakeholder','rule','pattern','infra','skill'
      )),
      belief_type TEXT NOT NULL DEFAULT 'fact' CHECK(belief_type IN (
        'directive','fact','handoff','watch','decision','pending'
      )),
      confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
      importance INTEGER NOT NULL DEFAULT 3 CHECK(importance >= 1 AND importance <= 5),
      tags TEXT,

      project TEXT,
      stakeholder TEXT,
      verify_by INTEGER,
      expires_at INTEGER,
      action TEXT,
      source_session INTEGER,

      derived_at INTEGER NOT NULL,
      last_evaluated INTEGER NOT NULL,
      supersedes_id TEXT REFERENCES beliefs(id),
      invalidated_at INTEGER,
      invalidation_reason TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `);
}
function createIndexes(database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_active ON beliefs(invalidated_at) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_domain ON beliefs(domain) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_type ON beliefs(belief_type) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_importance ON beliefs(importance DESC) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_project ON beliefs(project) WHERE invalidated_at IS NULL AND project IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_expires ON beliefs(expires_at) WHERE invalidated_at IS NULL AND expires_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_context ON beliefs(invalidated_at, belief_type, importance DESC) WHERE invalidated_at IS NULL;
  `);
}
function createFTS(database) {
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS beliefs_fts USING fts5(
        text, tags, project, stakeholder,
        content='beliefs',
        content_rowid='rowid',
        tokenize="unicode61 tokenchars '-_.'"
      )
    `);
  } catch {}
}
function createTriggers(database) {
  const triggers = [
    `CREATE TRIGGER IF NOT EXISTS beliefs_ai AFTER INSERT ON beliefs BEGIN
      INSERT INTO beliefs_fts(rowid, text, tags, project, stakeholder)
      VALUES (NEW.rowid, NEW.text, NEW.tags, NEW.project, NEW.stakeholder);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_ad AFTER DELETE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags, project, stakeholder)
      VALUES('delete', OLD.rowid, OLD.text, OLD.tags, OLD.project, OLD.stakeholder);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_au AFTER UPDATE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags, project, stakeholder)
      VALUES('delete', OLD.rowid, OLD.text, OLD.tags, OLD.project, OLD.stakeholder);
      INSERT INTO beliefs_fts(rowid, text, tags, project, stakeholder)
      VALUES (NEW.rowid, NEW.text, NEW.tags, NEW.project, NEW.stakeholder);
    END`
  ];
  for (const trigger of triggers) {
    try {
      database.exec(trigger);
    } catch {}
  }
}
function rebuildFTS(database) {
  try {
    database.exec("INSERT INTO beliefs_fts(beliefs_fts) VALUES('rebuild')");
  } catch {}
}
function initializeSchema(database) {
  if (isV1Schema(database)) {
    migrateV1toV2(database);
    createIndexes(database);
    createFTS(database);
    createTriggers(database);
    rebuildFTS(database);
  } else if (isV2Schema(database)) {
    createIndexes(database);
    createFTS(database);
    createTriggers(database);
  } else {
    createV2Schema(database);
    createIndexes(database);
    createFTS(database);
    createTriggers(database);
  }
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
// node_modules/uuid/dist/esm/native.js
import { randomUUID } from "crypto";
var native_default = { randomUUID };

// node_modules/uuid/dist/esm/rng.js
import { randomFillSync } from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm/stringify.js
var byteToHex = [];
for (let i = 0;i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// node_modules/uuid/dist/esm/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i = 0;i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;
// src/storage/sqlite.ts
import { Database as Database2 } from "bun:sqlite";
import { join as join4 } from "path";
var db2 = null;
function getDatabase2(projectDir) {
  if (db2)
    return db2;
  const dataDir = ensureDataDir2(projectDir);
  const dbPath = join4(dataDir, "memory.db");
  db2 = new Database2(dbPath);
  db2.exec("PRAGMA journal_mode = WAL");
  db2.exec("PRAGMA foreign_keys = ON");
  initializeSchema2(db2);
  return db2;
}
function isV1Schema2(database) {
  try {
    const row = database.query("SELECT COUNT(*) as cnt FROM pragma_table_info('beliefs') WHERE name = 'evidence_ids'").get();
    return row !== null && row.cnt > 0;
  } catch {
    return false;
  }
}
function isV2Schema2(database) {
  try {
    const row = database.query("SELECT COUNT(*) as cnt FROM pragma_table_info('beliefs') WHERE name = 'belief_type'").get();
    return row !== null && row.cnt > 0;
  } catch {
    return false;
  }
}
function migrateV1toV22(database) {
  database.exec("BEGIN TRANSACTION");
  try {
    database.exec(`
      CREATE TABLE beliefs_v2 (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL CHECK(length(text) <= 500),
        domain TEXT NOT NULL CHECK(domain IN (
          'handoff','watch','project','stakeholder','rule','pattern','infra','skill'
        )),
        belief_type TEXT NOT NULL DEFAULT 'fact' CHECK(belief_type IN (
          'directive','fact','handoff','watch','decision','pending'
        )),
        confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
        importance INTEGER NOT NULL DEFAULT 3 CHECK(importance >= 1 AND importance <= 5),
        tags TEXT,

        project TEXT,
        stakeholder TEXT,
        verify_by INTEGER,
        expires_at INTEGER,
        action TEXT,
        source_session INTEGER,

        derived_at INTEGER NOT NULL,
        last_evaluated INTEGER NOT NULL,
        supersedes_id TEXT REFERENCES beliefs(id),
        invalidated_at INTEGER,
        invalidation_reason TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);
    const oldRows = database.query("SELECT id, text, domain, confidence, derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, importance, tags, created_at FROM beliefs").all();
    const insert = database.prepare(`
      INSERT INTO beliefs_v2 (
        id, text, domain, belief_type, confidence, importance, tags,
        derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of oldRows) {
      const { newDomain, newType } = reclassify2(row.domain, row.text);
      const clampedImportance = Math.max(1, Math.min(5, row.importance ?? 3));
      const truncatedText = row.text.length > 500 ? row.text.slice(0, 497) + "..." : row.text;
      insert.run(row.id, truncatedText, newDomain, newType, row.confidence, clampedImportance, row.tags, row.derived_at, row.last_evaluated, row.supersedes_id, row.invalidated_at, row.invalidation_reason, row.created_at);
    }
    database.exec("DROP TRIGGER IF EXISTS beliefs_ai");
    database.exec("DROP TRIGGER IF EXISTS beliefs_ad");
    database.exec("DROP TRIGGER IF EXISTS beliefs_au");
    database.exec("DROP TRIGGER IF EXISTS events_ai");
    database.exec("DROP TRIGGER IF EXISTS events_ad");
    database.exec("DROP TRIGGER IF EXISTS events_au");
    database.exec("DROP TABLE IF EXISTS beliefs_fts");
    database.exec("DROP TABLE IF EXISTS events_fts");
    database.exec("DROP TABLE IF EXISTS predictions");
    database.exec("DROP TABLE IF EXISTS sessions");
    database.exec("DROP TABLE IF EXISTS events");
    database.exec("ALTER TABLE beliefs RENAME TO beliefs_legacy");
    database.exec("ALTER TABLE beliefs_v2 RENAME TO beliefs");
    database.exec("COMMIT");
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
}
function reclassify2(oldDomain, text) {
  const upper = text.toUpperCase();
  switch (oldDomain) {
    case "constraint": {
      const isDirective = /\b(NEVER|MUST|ALWAYS)\b/.test(upper);
      return { newDomain: "rule", newType: isDirective ? "directive" : "fact" };
    }
    case "workflow": {
      if (/HANDOFF/i.test(text)) {
        return { newDomain: "handoff", newType: "handoff" };
      }
      return { newDomain: "pattern", newType: "fact" };
    }
    case "decision":
      return { newDomain: "pattern", newType: "decision" };
    case "project_structure":
      return { newDomain: "infra", newType: "fact" };
    case "code_pattern":
      return { newDomain: "pattern", newType: "fact" };
    case "user_preference":
      return { newDomain: "rule", newType: "fact" };
    default: {
      const validDomains = ["handoff", "watch", "project", "stakeholder", "rule", "pattern", "infra", "skill"];
      if (validDomains.includes(oldDomain)) {
        return { newDomain: oldDomain, newType: inferType2(text) };
      }
      return { newDomain: "pattern", newType: "fact" };
    }
  }
}
function inferType2(text) {
  const upper = text.toUpperCase();
  if (/\b(NEVER|MUST|ALWAYS|SHALL NOT|REQUIRED)\b/.test(upper))
    return "directive";
  if (/\bHANDOFF\b/i.test(text))
    return "handoff";
  if (/\bWATCH\b/i.test(text))
    return "watch";
  if (/\bPENDING\b/i.test(text))
    return "pending";
  return "fact";
}
function createV2Schema2(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS beliefs (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL CHECK(length(text) <= 500),
      domain TEXT NOT NULL CHECK(domain IN (
        'handoff','watch','project','stakeholder','rule','pattern','infra','skill'
      )),
      belief_type TEXT NOT NULL DEFAULT 'fact' CHECK(belief_type IN (
        'directive','fact','handoff','watch','decision','pending'
      )),
      confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
      importance INTEGER NOT NULL DEFAULT 3 CHECK(importance >= 1 AND importance <= 5),
      tags TEXT,

      project TEXT,
      stakeholder TEXT,
      verify_by INTEGER,
      expires_at INTEGER,
      action TEXT,
      source_session INTEGER,

      derived_at INTEGER NOT NULL,
      last_evaluated INTEGER NOT NULL,
      supersedes_id TEXT REFERENCES beliefs(id),
      invalidated_at INTEGER,
      invalidation_reason TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `);
}
function createIndexes2(database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_active ON beliefs(invalidated_at) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_domain ON beliefs(domain) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_type ON beliefs(belief_type) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_importance ON beliefs(importance DESC) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_project ON beliefs(project) WHERE invalidated_at IS NULL AND project IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_expires ON beliefs(expires_at) WHERE invalidated_at IS NULL AND expires_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_context ON beliefs(invalidated_at, belief_type, importance DESC) WHERE invalidated_at IS NULL;
  `);
}
function createFTS2(database) {
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS beliefs_fts USING fts5(
        text, tags, project, stakeholder,
        content='beliefs',
        content_rowid='rowid',
        tokenize="unicode61 tokenchars '-_.'"
      )
    `);
  } catch {}
}
function createTriggers2(database) {
  const triggers = [
    `CREATE TRIGGER IF NOT EXISTS beliefs_ai AFTER INSERT ON beliefs BEGIN
      INSERT INTO beliefs_fts(rowid, text, tags, project, stakeholder)
      VALUES (NEW.rowid, NEW.text, NEW.tags, NEW.project, NEW.stakeholder);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_ad AFTER DELETE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags, project, stakeholder)
      VALUES('delete', OLD.rowid, OLD.text, OLD.tags, OLD.project, OLD.stakeholder);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_au AFTER UPDATE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags, project, stakeholder)
      VALUES('delete', OLD.rowid, OLD.text, OLD.tags, OLD.project, OLD.stakeholder);
      INSERT INTO beliefs_fts(rowid, text, tags, project, stakeholder)
      VALUES (NEW.rowid, NEW.text, NEW.tags, NEW.project, NEW.stakeholder);
    END`
  ];
  for (const trigger of triggers) {
    try {
      database.exec(trigger);
    } catch {}
  }
}
function rebuildFTS2(database) {
  try {
    database.exec("INSERT INTO beliefs_fts(beliefs_fts) VALUES('rebuild')");
  } catch {}
}
function initializeSchema2(database) {
  if (isV1Schema2(database)) {
    migrateV1toV22(database);
    createIndexes2(database);
    createFTS2(database);
    createTriggers2(database);
    rebuildFTS2(database);
  } else if (isV2Schema2(database)) {
    createIndexes2(database);
    createFTS2(database);
    createTriggers2(database);
  } else {
    createV2Schema2(database);
    createIndexes2(database);
    createFTS2(database);
    createTriggers2(database);
  }
}

// src/utils/scoring.ts
function autoDetectDomain(text) {
  if (/\b(NEVER|ALWAYS|MUST|CRITICAL|rule|mandate)\b/i.test(text))
    return "rule";
  if (/\b(HANDOFF|NEXT|resume|session\s+\d+)\b/i.test(text))
    return "handoff";
  if (/\b(verify|regress|watch|fragile|broke\s+again|still\s+works)\b/i.test(text))
    return "watch";
  if (/\b(port|service|nginx|systemd|VPS|server|SSL|DNS)\b/i.test(text))
    return "infra";
  if (/\b(deploy|pipeline|workflow|pattern|architecture)\b/i.test(text))
    return "pattern";
  if (/\b(waiting|asked|request|stakeholder|deliverable)\b/i.test(text))
    return "stakeholder";
  if (/\b(skill|command|tool|hook|plugin)\b/i.test(text))
    return "skill";
  return "project";
}
function autoDetectType(text, domain) {
  if (domain === "handoff")
    return "handoff";
  if (domain === "watch")
    return "watch";
  if (/\b(NEVER|ALWAYS|MUST|DO NOT|rule)\b/i.test(text))
    return "directive";
  if (/\b(waiting|pending|needs|asked for)\b/i.test(text))
    return "pending";
  if (/\b(decided|chose|because|rationale)\b/i.test(text))
    return "decision";
  return "fact";
}
function computeImportance(belief) {
  const domainWeights = {
    rule: 5,
    handoff: 5,
    watch: 4,
    stakeholder: 4,
    infra: 3,
    project: 3,
    pattern: 3,
    skill: 2
  };
  let score = domainWeights[belief.domain];
  if (belief.belief_type === "directive")
    score = Math.max(score, 4);
  if (belief.belief_type === "pending")
    score = Math.max(score, 4);
  if (/\bCRITICAL\b/i.test(belief.text))
    score = 5;
  if (/\bNEVER\b/i.test(belief.text))
    score = Math.max(score, 4);
  return Math.min(5, Math.max(1, score));
}
function computeContextScore(belief, options) {
  let score = 0;
  const typeWeights = {
    handoff: 100,
    pending: 80,
    watch: 70,
    directive: 60,
    fact: 40,
    decision: 20
  };
  score += typeWeights[belief.belief_type];
  const ageHours = (Date.now() - belief.derived_at) / 3600000;
  if (ageHours < 24)
    score += 20;
  else if (ageHours < 168)
    score += 10;
  score += belief.importance * 2;
  score += belief.confidence * 10;
  const evalAgeDays = (Date.now() - belief.last_evaluated) / 86400000;
  if (evalAgeDays > 7)
    score -= 10;
  if (evalAgeDays > 30)
    score -= 20;
  if (options.projectName && belief.project === options.projectName) {
    score += 25;
  }
  return score;
}
var SYNONYM_GROUPS = [
  ["database", "db", "sqlite", "postgresql", "postgres", "mysql", "mariadb", "sql", "migration"],
  ["auth", "authentication", "login", "jwt", "token", "bcrypt", "password", "session", "credential"],
  ["deploy", "deployment", "ship", "release", "publish", "production", "staging"],
  ["test", "testing", "spec", "assertion", "expect", "jest", "vitest"],
  ["error", "exception", "crash", "bug", "failure", "broken", "fix"],
  ["api", "endpoint", "route", "handler", "rest", "graphql", "http"],
  ["frontend", "ui", "react", "vue", "component", "css", "html", "browser"],
  ["backend", "server", "express", "fastify", "node", "bun", "runtime"],
  ["docker", "container", "image", "kubernetes", "k8s", "pod"],
  ["git", "commit", "branch", "merge", "rebase", "push", "pull"],
  ["config", "configuration", "env", "environment", "settings", "dotenv"],
  ["cache", "redis", "memcached", "caching"],
  ["queue", "worker", "job", "background", "async", "rabbitmq", "bull"],
  ["monitor", "monitoring", "log", "logging", "metric", "alert", "observability"],
  ["security", "vulnerability", "xss", "injection", "csrf", "cors"],
  ["id", "uuid", "identifier", "primary key", "sequential", "auto-increment", "autoincrement"],
  ["priority", "urgent", "critical", "high", "low", "medium"],
  ["user", "account", "profile", "role", "permission"],
  ["file", "upload", "download", "storage", "blob", "s3"],
  ["email", "mail", "smtp", "notification", "message"],
  ["port", "listen", "bind", "host", "address"],
  ["nginx", "proxy", "reverse proxy", "load balancer", "ssl", "tls", "https"],
  ["service", "systemd", "daemon", "process", "pid"],
  ["stakeholder", "client", "customer", "requester", "user request"]
];
function expandQuery(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const group of SYNONYM_GROUPS) {
      if (matchesSynonymGroup(term, group)) {
        for (const syn of group) {
          expanded.add(syn);
        }
      }
    }
  }
  return [...expanded];
}
function simpleStem(word) {
  if (word.endsWith("ing") && word.length > 5)
    return word.slice(0, -3);
  if (word.endsWith("tion") && word.length > 5)
    return word.slice(0, -4);
  if (word.endsWith("ed") && word.length > 4)
    return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4)
    return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}
function matchesSynonymGroup(word, group) {
  const stemmed = simpleStem(word);
  return group.some((syn) => {
    if (syn === word)
      return true;
    const synStemmed = simpleStem(syn);
    if (stemmed === synStemmed)
      return true;
    if (stemmed === syn || word === synStemmed)
      return true;
    return false;
  });
}
function wordMatchesInText(word, text) {
  const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  if (wordRegex.test(text))
    return true;
  for (const group of SYNONYM_GROUPS) {
    if (matchesSynonymGroup(word, group)) {
      for (const syn of group) {
        if (syn.length > 2) {
          const synRegex = new RegExp(`\\b${syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
          if (synRegex.test(text))
            return true;
        }
      }
    }
  }
  return false;
}
function areContradictory(textA, textB) {
  const a = textA.toLowerCase();
  const b = textB.toLowerCase();
  function forbiddenMatchesText(forbidden, text, negWords) {
    if (negWords.some((nw) => text.includes(nw)))
      return false;
    if (text.includes(forbidden))
      return true;
    const forbiddenWords = forbidden.split(/\s+/).filter((w) => w.length > 2);
    if (forbiddenWords.length > 0) {
      const matchCount = forbiddenWords.filter((w) => wordMatchesInText(w, text)).length;
      const primaryMatches = forbiddenWords.length > 0 && wordMatchesInText(forbiddenWords[0], text);
      if (forbiddenWords.length <= 2) {
        if (primaryMatches)
          return true;
      } else {
        if (matchCount / forbiddenWords.length >= 0.5)
          return true;
      }
    }
    return false;
  }
  const neverMatch = a.match(/\bnever\s+(?:use|do|send|store|run|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (neverMatch) {
    const forbidden = neverMatch[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, b, ["never", "do not", "don't"])) {
      return true;
    }
  }
  const neverMatchB = b.match(/\bnever\s+(?:use|do|send|store|run|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (neverMatchB) {
    const forbidden = neverMatchB[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, a, ["never", "do not", "don't"])) {
      return true;
    }
  }
  const doNotMatch = a.match(/\b(?:do not|don't|should not|must not)\s+(?:use|do|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (doNotMatch) {
    const forbidden = doNotMatch[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, b, ["not", "never", "don't"])) {
      return true;
    }
  }
  const doNotMatchB = b.match(/\b(?:do not|don't|should not|must not)\s+(?:use|do|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (doNotMatchB) {
    const forbidden = doNotMatchB[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, a, ["not", "never", "don't"])) {
      return true;
    }
  }
  const pendingA = /\b(?:pending|waiting|requested|needs)\b/i.test(a);
  const doneA = /\b(?:shipped|completed|done|delivered|implemented|finished)\b/i.test(a);
  const pendingB = /\b(?:pending|waiting|requested|needs)\b/i.test(b);
  const doneB = /\b(?:shipped|completed|done|delivered|implemented|finished)\b/i.test(b);
  if (pendingA && doneB || doneA && pendingB) {
    const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
    const minSize = Math.min(wordsA.size, wordsB.size);
    if (minSize > 0 && overlap / minSize > 0.3) {
      return true;
    }
  }
  function extractNegatedSubject(text) {
    const match = text.match(/\b(?:has no|have no|no|lacks?|without)\s+(.+?)(?:\s*[.!,;:\u2014-]|$)/i);
    return match ? match[1].trim().toLowerCase() : null;
  }
  const negA = extractNegatedSubject(a);
  if (negA) {
    const subjectWords = negA.split(/\s+/).filter((w) => w.length > 2);
    const matchCount = subjectWords.filter((w) => wordMatchesInText(w, b)).length;
    if (subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5 && !b.includes("no ") && !b.includes("not ") && !b.includes("lacks") && !b.includes("without")) {
      return true;
    }
  }
  const negB = extractNegatedSubject(b);
  if (negB) {
    const subjectWords = negB.split(/\s+/).filter((w) => w.length > 2);
    const matchCount = subjectWords.filter((w) => wordMatchesInText(w, a)).length;
    if (subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5 && !a.includes("no ") && !a.includes("not ") && !a.includes("lacks") && !a.includes("without")) {
      return true;
    }
  }
  const p5Regex = /(?<!\b(?:do|should|must|can|will|would|could|shall))\s+not\s+(?:yet\s+)?(.+?)(?:\s*[.!,;:\u2014-]|$)/i;
  const notYetA = a.match(p5Regex);
  if (notYetA) {
    const subject = notYetA[1].trim().toLowerCase();
    if (!/^(?:add|use|do|create|make|send|store|run)\b/.test(subject)) {
      const subjectWords = subject.split(/\s+/).filter((w) => w.length > 2);
      const hasAffirmB = /\b(?:implemented|done|shipped|completed|finished|added|exists|deployed)\b/i.test(b);
      const matchCount = subjectWords.filter((w) => wordMatchesInText(w, b)).length;
      if (hasAffirmB && subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5) {
        return true;
      }
    }
  }
  const notYetB = b.match(p5Regex);
  if (notYetB) {
    const subject = notYetB[1].trim().toLowerCase();
    if (!/^(?:add|use|do|create|make|send|store|run)\b/.test(subject)) {
      const subjectWords = subject.split(/\s+/).filter((w) => w.length > 2);
      const hasAffirmA = /\b(?:implemented|done|shipped|completed|finished|added|exists|deployed)\b/i.test(a);
      const matchCount = subjectWords.filter((w) => wordMatchesInText(w, a)).length;
      if (hasAffirmA && subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5) {
        return true;
      }
    }
  }
  const hasNegationA = /\b(?:no|not|never|lacks?|without|don't|doesn't|hasn't|haven't)\b/i.test(a);
  const hasNegationB = /\b(?:no|not|never|lacks?|without|don't|doesn't|hasn't|haven't)\b/i.test(b);
  if (hasNegationA !== hasNegationB) {
    const sigWords = (s) => {
      const words = s.replace(/[^\w\s-]/g, "").split(/\s+/).filter(Boolean);
      const stopList = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "has", "have", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "need", "must", "on", "in", "at", "to", "for", "of", "with", "by", "from", "as", "and", "but", "or", "nor", "not", "so", "yet", "no", "this", "that", "it", "its", "never", "lacks", "without", "don't", "doesn't", "hasn't", "haven't", "use", "uses", "used", "using", "under", "load", "break", "test", "tested", "testing", "work", "works", "working", "also", "just", "like", "make", "new", "old", "all", "any", "some", "each", "every", "watch", "rule", "added", "done", "still"]);
      return words.filter((w) => !stopList.has(w) && w.length > 2);
    };
    const wordsA = sigWords(a);
    const wordsB = sigWords(b);
    const setBWords = new Set(wordsB);
    const overlap = wordsA.filter((w) => setBWords.has(w)).length;
    const minLen = Math.min(wordsA.length, wordsB.length);
    if (minLen > 0 && overlap >= 2 && overlap / minLen >= 0.4) {
      return true;
    }
  }
  return false;
}
var STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "must",
  "on",
  "in",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "into",
  "about",
  "between",
  "through",
  "during",
  "before",
  "after",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "so",
  "yet",
  "both",
  "either",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its"
]);
function jaccardSimilarity(a, b) {
  const tokenize = (s) => {
    const words = s.toLowerCase().replace(/[^\w\s-]/g, "").split(/\s+/).filter(Boolean);
    return new Set(words.filter((w) => !STOP_WORDS.has(w) && w.length > 1));
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0)
    return 1;
  if (setA.size === 0 || setB.size === 0)
    return 0;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// src/utils/lifecycle.ts
function computeDecay(belief, lifecycle) {
  if (lifecycle.decayRate === 0)
    return belief.confidence;
  const ageDays = (Date.now() - belief.derived_at) / 86400000;
  if (ageDays <= lifecycle.decayAfterDays)
    return belief.confidence;
  const decayDays = ageDays - lifecycle.decayAfterDays;
  const decayed = belief.confidence - lifecycle.decayRate * decayDays;
  return Math.max(0, Math.min(1, decayed));
}
function isExpired(belief) {
  if (belief.expires_at && Date.now() > belief.expires_at)
    return true;
  return false;
}
function detectContradictions(beliefs) {
  const pairs = [];
  for (let i = 0;i < beliefs.length; i++) {
    for (let j = i + 1;j < beliefs.length; j++) {
      if (areContradictory(beliefs[i].text, beliefs[j].text)) {
        pairs.push([beliefs[i], beliefs[j]]);
      }
    }
  }
  return pairs;
}
function formatOrientOutput(beliefs, totalStored) {
  const sections = {
    "RESUME FROM LAST SESSION": [],
    "HARD CONSTRAINTS (never violate)": [],
    "PENDING DELIVERABLES": [],
    "REGRESSION WATCH": [],
    "SYSTEM KNOWLEDGE": []
  };
  for (const b of beliefs) {
    const tag = `[${b.domain}]`;
    const line = `- ${tag} ${b.text}`;
    if (b.belief_type === "handoff") {
      sections["RESUME FROM LAST SESSION"].push(line);
    } else if (b.belief_type === "directive" || b.domain === "rule") {
      sections["HARD CONSTRAINTS (never violate)"].push(line);
    } else if (b.belief_type === "pending") {
      sections["PENDING DELIVERABLES"].push(line);
    } else if (b.belief_type === "watch" || b.domain === "watch") {
      sections["REGRESSION WATCH"].push(line);
    } else {
      sections["SYSTEM KNOWLEDGE"].push(line);
    }
  }
  const lines = [];
  for (const [title, items] of Object.entries(sections)) {
    if (items.length === 0)
      continue;
    lines.push(`## ${title}`);
    lines.push(...items);
    lines.push("");
  }
  const contradictions = detectContradictions(beliefs);
  if (contradictions.length > 0) {
    lines.push("## CONFLICTS (resolve these)");
    for (const [a, b] of contradictions) {
      const aText = a.text.length > 80 ? a.text.slice(0, 80) + "..." : a.text;
      const bText = b.text.length > 80 ? b.text.slice(0, 80) + "..." : b.text;
      lines.push(`- CONFLICT: "${aText}" vs "${bText}"`);
      lines.push(`  IDs: ${a.id.slice(0, 8)} vs ${b.id.slice(0, 8)}`);
    }
    lines.push("");
  }
  const tokenEstimate = beliefs.reduce((sum, b) => sum + Math.ceil(b.text.length / 4) + 15, 0);
  lines.push(`[${beliefs.length} beliefs loaded / ${totalStored} stored / ~${tokenEstimate} tokens used]`);
  lines.push('Use `mem-reason check "<topic>"` to query specific knowledge.');
  return lines.join(`
`);
}

// src/storage/belief-store.ts
class BeliefStore {
  get db() {
    return getDatabase2();
  }
  create(input) {
    const domain = input.domain ?? autoDetectDomain(input.text);
    const beliefType = input.belief_type ?? autoDetectType(input.text, domain);
    const tags = input.tags ?? [];
    const importance = input.importance ?? computeImportance({ domain, belief_type: beliefType, text: input.text, tags });
    const confidence = input.confidence ?? this.computeInitialConfidence(domain, beliefType);
    const now = Date.now();
    const duplicate = this.findDuplicate(input.text, domain, 0.5);
    if (duplicate) {
      if (domain !== "rule") {
        const rules = this.getActive({ domain: "rule" });
        for (const rule of rules) {
          if (areContradictory(input.text, rule.text)) {
            process.stderr.write(`WARNING: Contradicts rule [${rule.id.slice(0, 8)}]: "${rule.text.slice(0, 80)}"
`);
            break;
          }
        }
      }
      return this.merge(duplicate, input);
    }
    if (/\b(shipped|completed|done|delivered|implemented|finished)\b/i.test(input.text)) {
      const pendingBeliefs = this.getActive({ domain }).filter((b) => b.belief_type === "pending" && this.textsShareSubject(input.text, b.text));
      for (const pending of pendingBeliefs) {
        this.invalidate(pending.id, "Superseded by shipped/completed version");
      }
    }
    let supersedesId = input.supersedes_id ?? null;
    const contradiction = this.findContradiction(input.text, domain);
    if (contradiction) {
      if (contradiction.isRule && domain !== "rule") {
        process.stderr.write(`WARNING: Contradicts rule [${contradiction.belief.id.slice(0, 8)}]: "${contradiction.belief.text.slice(0, 80)}"
`);
      } else {
        this.invalidate(contradiction.belief.id, `Contradicted by newer belief`);
        supersedesId = contradiction.belief.id;
        process.stderr.write(`SUPERSEDED: Old belief [${contradiction.belief.id.slice(0, 8)}] invalidated -- contradicted by this one
`);
      }
    }
    const id = v4_default();
    const stmt = this.db.prepare(`
      INSERT INTO beliefs (
        id, text, domain, belief_type, confidence, importance, tags,
        project, stakeholder, verify_by, expires_at, action, source_session,
        derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, input.text, domain, beliefType, confidence, importance, JSON.stringify(tags), input.project ?? null, input.stakeholder ?? null, input.verify_by ?? null, input.expires_at ?? null, input.action ?? null, input.source_session ?? null, now, now, supersedesId, null, null);
    return {
      id,
      text: input.text,
      domain,
      belief_type: beliefType,
      confidence,
      importance,
      tags,
      project: input.project,
      stakeholder: input.stakeholder,
      verify_by: input.verify_by,
      expires_at: input.expires_at,
      action: input.action,
      source_session: input.source_session,
      derived_at: now,
      last_evaluated: now,
      supersedes_id: supersedesId ?? undefined
    };
  }
  findDuplicate(text, domain, threshold) {
    const actives = this.getActive({ domain });
    for (const belief of actives) {
      const jaccard = jaccardSimilarity(text, belief.text);
      let effectiveThreshold = threshold;
      if (jaccard < threshold && jaccard >= 0.2) {
        const sharedSigWords = this.countSharedSignificantWords(text, belief.text);
        if (sharedSigWords >= 3) {
          effectiveThreshold = 0.25;
        }
      }
      if (jaccard >= effectiveThreshold) {
        return belief;
      }
    }
    return null;
  }
  findContradiction(text, domain) {
    const actives = this.getActive({ domain });
    for (const belief of actives) {
      if (areContradictory(text, belief.text)) {
        return { belief, isRule: domain === "rule" };
      }
    }
    const allDomains = ["rule", "project", "infra", "pattern", "stakeholder", "watch", "skill", "handoff"];
    for (const crossDomain of allDomains) {
      if (crossDomain === domain)
        continue;
      const beliefs = this.getActive({ domain: crossDomain });
      for (const belief of beliefs) {
        if (areContradictory(text, belief.text)) {
          return { belief, isRule: crossDomain === "rule" };
        }
      }
    }
    return null;
  }
  merge(existing, newer) {
    const updatedText = newer.text || existing.text;
    const updatedConfidence = Math.min(1, existing.confidence + 0.05);
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE beliefs
      SET text = ?, confidence = ?, last_evaluated = ?
      WHERE id = ?
    `);
    stmt.run(updatedText, updatedConfidence, now, existing.id);
    return {
      ...existing,
      text: updatedText,
      confidence: updatedConfidence,
      last_evaluated: now
    };
  }
  getById(id) {
    const stmt = this.db.prepare("SELECT * FROM beliefs WHERE id = ?");
    const row = stmt.get(id);
    if (!row)
      return null;
    return this.rowToBelief(row);
  }
  getActive(options = {}) {
    let query = "SELECT * FROM beliefs WHERE invalidated_at IS NULL";
    const params = [];
    if (options.minConfidence) {
      query += " AND confidence >= ?";
      params.push(options.minConfidence);
    }
    if (options.domain) {
      query += " AND domain = ?";
      params.push(options.domain);
    }
    query += " ORDER BY importance DESC, confidence DESC";
    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map((row) => this.rowToBelief(row));
  }
  getContextBeliefs(options) {
    const allActive = this.getActive({ minConfidence: 0.3 });
    const scored = allActive.map((belief) => ({
      belief,
      score: computeContextScore(belief, options),
      estimatedTokens: Math.ceil(belief.text.length / 4) + 15
    }));
    scored.sort((a, b) => b.score - a.score);
    const selected = [];
    let tokensBudgetRemaining = options.tokenBudget;
    const criticalTypes = ["handoff", "pending", "watch", "directive"];
    const usedIds = new Set;
    for (const ctype of criticalTypes) {
      const candidate = scored.find((s) => s.belief.belief_type === ctype && !usedIds.has(s.belief.id));
      if (candidate && candidate.estimatedTokens <= tokensBudgetRemaining) {
        selected.push(candidate);
        usedIds.add(candidate.belief.id);
        tokensBudgetRemaining -= candidate.estimatedTokens;
      }
    }
    for (const entry of scored) {
      if (usedIds.has(entry.belief.id))
        continue;
      if (entry.estimatedTokens > tokensBudgetRemaining)
        continue;
      selected.push(entry);
      usedIds.add(entry.belief.id);
      tokensBudgetRemaining -= entry.estimatedTokens;
    }
    selected.sort((a, b) => b.score - a.score);
    return selected;
  }
  orient() {
    const beliefs = this.getContextBeliefs({ tokenBudget: 3000, sessionType: "interactive" });
    const totalStored = this.count();
    return formatOrientOutput(beliefs.map((sb) => sb.belief), totalStored);
  }
  search(query, options = {}) {
    const sanitized = this.sanitizeFtsQuery(query);
    try {
      const results = this.searchFTS(sanitized, options);
      if (results.length > 0)
        return results;
    } catch {}
    return this.searchLike(query, options);
  }
  check(topic, limit = 3) {
    const direct = this.search(topic, { limit });
    if (direct.length >= limit)
      return direct;
    const expanded = expandQuery(topic);
    const seen = new Set(direct.map((b) => b.id));
    const results = [...direct];
    for (const term of expanded) {
      if (results.length >= limit)
        break;
      const found = this.search(term, { limit: limit - results.length });
      for (const b of found) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          results.push(b);
        }
      }
    }
    return results.slice(0, limit);
  }
  invalidate(id, reason) {
    const stmt = this.db.prepare(`
      UPDATE beliefs
      SET invalidated_at = ?, invalidation_reason = ?
      WHERE id = ? AND invalidated_at IS NULL
    `);
    const result = stmt.run(Date.now(), reason, id);
    return result.changes > 0;
  }
  update(id, changes) {
    const existing = this.getById(id);
    if (!existing)
      return null;
    const updates = [];
    const params = [];
    if (changes.text !== undefined) {
      updates.push("text = ?");
      params.push(changes.text);
    }
    if (changes.confidence !== undefined) {
      updates.push("confidence = ?");
      params.push(changes.confidence);
    }
    if (changes.importance !== undefined) {
      updates.push("importance = ?");
      params.push(changes.importance);
    }
    if (changes.domain !== undefined) {
      updates.push("domain = ?");
      params.push(changes.domain);
    }
    if (changes.belief_type !== undefined) {
      updates.push("belief_type = ?");
      params.push(changes.belief_type);
    }
    if (changes.tags !== undefined) {
      updates.push("tags = ?");
      params.push(JSON.stringify(changes.tags));
    }
    if (changes.project !== undefined) {
      updates.push("project = ?");
      params.push(changes.project ?? null);
    }
    if (changes.stakeholder !== undefined) {
      updates.push("stakeholder = ?");
      params.push(changes.stakeholder ?? null);
    }
    if (changes.verify_by !== undefined) {
      updates.push("verify_by = ?");
      params.push(changes.verify_by ?? null);
    }
    if (changes.expires_at !== undefined) {
      updates.push("expires_at = ?");
      params.push(changes.expires_at ?? null);
    }
    if (changes.action !== undefined) {
      updates.push("action = ?");
      params.push(changes.action ?? null);
    }
    if (changes.source_session !== undefined) {
      updates.push("source_session = ?");
      params.push(changes.source_session ?? null);
    }
    if (changes.last_evaluated !== undefined) {
      updates.push("last_evaluated = ?");
      params.push(changes.last_evaluated);
    }
    if (updates.length === 0)
      return existing;
    params.push(id);
    const stmt = this.db.prepare(`UPDATE beliefs SET ${updates.join(", ")} WHERE id = ?`);
    stmt.run(...params);
    return this.getById(id);
  }
  count(options = {}) {
    let query = "SELECT COUNT(*) as count FROM beliefs";
    const conditions = [];
    const params = [];
    if (options.activeOnly !== false) {
      conditions.push("invalidated_at IS NULL");
    }
    if (options.domain) {
      conditions.push("domain = ?");
      params.push(options.domain);
    }
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    const stmt = this.db.prepare(query);
    const result = stmt.get(...params);
    return result.count;
  }
  getStatsPerDomain() {
    const stmt = this.db.prepare(`
      SELECT domain, COUNT(*) as count, AVG(confidence) as avgConfidence
      FROM beliefs
      WHERE invalidated_at IS NULL
      GROUP BY domain
    `);
    const rows = stmt.all();
    const stats = {};
    for (const row of rows) {
      stats[row.domain] = {
        count: row.count,
        avgConfidence: row.avgConfidence
      };
    }
    return stats;
  }
  createHandoff(text, sessionNumber) {
    const activeHandoffs = this.getActive({ domain: "handoff" });
    for (const h of activeHandoffs) {
      this.invalidate(h.id, "Superseded by new handoff");
    }
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    return this.create({
      text,
      domain: "handoff",
      belief_type: "handoff",
      confidence: 1,
      importance: 5,
      expires_at: Date.now() + twoDays,
      source_session: sessionNumber,
      tags: ["handoff"]
    });
  }
  curate(dryRun = false) {
    const stats = { expired: 0, decayed: 0, merged: 0, capped: 0, invalidated: 0, resolved: 0 };
    const allActive = this.getActive();
    for (const belief of allActive) {
      if (isExpired(belief)) {
        stats.expired++;
        if (!dryRun) {
          this.invalidate(belief.id, "Expired (past expires_at)");
        }
      }
    }
    const stillActive = dryRun ? allActive.filter((b) => !isExpired(b)) : this.getActive();
    for (const belief of stillActive) {
      const lifecycle = DOMAIN_LIFECYCLES[belief.domain];
      if (!lifecycle)
        continue;
      const decayed = computeDecay(belief, lifecycle);
      if (decayed < belief.confidence) {
        stats.decayed++;
        if (!dryRun) {
          this.update(belief.id, { confidence: decayed, last_evaluated: Date.now() });
        }
      }
    }
    const postDecay = dryRun ? stillActive : this.getActive();
    const domains = [...new Set(postDecay.map((b) => b.domain))];
    const mergedIds = new Set;
    for (const domain of domains) {
      const domainBeliefs = postDecay.filter((b) => b.domain === domain && !mergedIds.has(b.id));
      for (let i = 0;i < domainBeliefs.length; i++) {
        if (mergedIds.has(domainBeliefs[i].id))
          continue;
        for (let j = i + 1;j < domainBeliefs.length; j++) {
          if (mergedIds.has(domainBeliefs[j].id))
            continue;
          const jaccard = jaccardSimilarity(domainBeliefs[i].text, domainBeliefs[j].text);
          let threshold = 0.5;
          if (jaccard < 0.5 && jaccard >= 0.2) {
            const sharedSigWords = this.countSharedSignificantWords(domainBeliefs[i].text, domainBeliefs[j].text);
            if (sharedSigWords >= 3) {
              threshold = 0.25;
            }
          }
          if (jaccard > threshold) {
            stats.merged++;
            mergedIds.add(domainBeliefs[j].id);
            if (!dryRun) {
              const keeper = domainBeliefs[i].confidence >= domainBeliefs[j].confidence ? domainBeliefs[i] : domainBeliefs[j];
              const loser = keeper.id === domainBeliefs[i].id ? domainBeliefs[j] : domainBeliefs[i];
              this.merge(keeper, { text: keeper.text, domain: keeper.domain });
              this.invalidate(loser.id, `Merged into ${keeper.id}`);
            }
          }
        }
      }
    }
    const postMerge = dryRun ? postDecay.filter((b) => !mergedIds.has(b.id)) : this.getActive();
    for (const domain of domains) {
      const lifecycle = DOMAIN_LIFECYCLES[domain];
      if (!lifecycle)
        continue;
      const domainBeliefs = postMerge.filter((b) => b.domain === domain).sort((a, b) => {
        if (b.importance !== a.importance)
          return b.importance - a.importance;
        return b.confidence - a.confidence;
      });
      if (domainBeliefs.length > lifecycle.maxPerDomain) {
        const excess = domainBeliefs.slice(lifecycle.maxPerDomain);
        for (const belief of excess) {
          stats.capped++;
          if (!dryRun) {
            this.invalidate(belief.id, `Domain cap exceeded (${domain}: max ${lifecycle.maxPerDomain})`);
          }
        }
      }
    }
    const postCap = dryRun ? postMerge : this.getActive();
    for (const belief of postCap) {
      if (belief.confidence < 0.2) {
        stats.invalidated++;
        if (!dryRun) {
          this.invalidate(belief.id, "Confidence below threshold (< 0.2)");
        }
      }
    }
    const postInvalidate = dryRun ? postCap.filter((b) => b.confidence >= 0.2) : this.getActive();
    const contradictionPairs = this.findAllContradictions(postInvalidate);
    for (const [beliefA, beliefB] of contradictionPairs) {
      stats.resolved++;
      if (!dryRun) {
        const winner = this.resolveContradiction(beliefA, beliefB);
        const loser = winner.id === beliefA.id ? beliefB : beliefA;
        this.invalidate(loser.id, `Contradicted by ${winner.id.slice(0, 8)} (auto-resolved by curate)`);
      }
    }
    return stats;
  }
  findAllContradictions(beliefs) {
    const pairs = [];
    const resolved = new Set;
    for (let i = 0;i < beliefs.length; i++) {
      if (resolved.has(beliefs[i].id))
        continue;
      for (let j = i + 1;j < beliefs.length; j++) {
        if (resolved.has(beliefs[j].id))
          continue;
        if (areContradictory(beliefs[i].text, beliefs[j].text)) {
          pairs.push([beliefs[i], beliefs[j]]);
          const winner = this.resolveContradiction(beliefs[i], beliefs[j]);
          const loserId = winner.id === beliefs[i].id ? beliefs[j].id : beliefs[i].id;
          resolved.add(loserId);
        }
      }
    }
    return pairs;
  }
  resolveContradiction(a, b) {
    const aIsRule = a.domain === "rule" || a.belief_type === "directive";
    const bIsRule = b.domain === "rule" || b.belief_type === "directive";
    if (aIsRule && !bIsRule)
      return a;
    if (bIsRule && !aIsRule)
      return b;
    const aShipped = /\b(shipped|completed|done|delivered|implemented|finished)\b/i.test(a.text);
    const bShipped = /\b(shipped|completed|done|delivered|implemented|finished)\b/i.test(b.text);
    const aPending = /\b(pending|waiting|requested|needs)\b/i.test(a.text);
    const bPending = /\b(pending|waiting|requested|needs)\b/i.test(b.text);
    if (aShipped && bPending)
      return a;
    if (bShipped && aPending)
      return b;
    if (a.importance !== b.importance)
      return a.importance > b.importance ? a : b;
    if (Math.abs(a.confidence - b.confidence) > 0.05)
      return a.confidence > b.confidence ? a : b;
    return a.derived_at >= b.derived_at ? a : b;
  }
  countSharedSignificantWords(textA, textB) {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "has",
      "have",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "need",
      "must",
      "on",
      "in",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "and",
      "but",
      "or",
      "nor",
      "not",
      "so",
      "yet",
      "this",
      "that",
      "it",
      "its",
      "all",
      "uses",
      "use",
      "used",
      "using"
    ]);
    const tokenize = (s) => {
      const words = s.toLowerCase().replace(/[^\w\s-]/g, "").split(/\s+/).filter(Boolean);
      return new Set(words.filter((w) => !stopWords.has(w) && w.length > 2));
    };
    const wordsA = tokenize(textA);
    const wordsB = tokenize(textB);
    return [...wordsA].filter((w) => wordsB.has(w)).length;
  }
  sanitizeFtsQuery(query) {
    return query.replace(/(\w+(?:-\w+)+)/g, '"$1"');
  }
  searchFTS(query, options) {
    let sql = `
      SELECT b.* FROM beliefs b
      JOIN beliefs_fts fts ON b.rowid = fts.rowid
      WHERE beliefs_fts MATCH ?
    `;
    const params = [query];
    if (options.activeOnly !== false) {
      sql += " AND b.invalidated_at IS NULL";
    }
    if (options.minConfidence) {
      sql += " AND b.confidence >= ?";
      params.push(options.minConfidence);
    }
    if (options.domain) {
      sql += " AND b.domain = ?";
      params.push(options.domain);
    }
    sql += " ORDER BY rank";
    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => this.rowToBelief(row));
  }
  searchLike(query, options) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0)
      return [];
    let sql = "SELECT * FROM beliefs WHERE 1=1";
    const params = [];
    const termConditions = [];
    for (const term of terms) {
      termConditions.push("(LOWER(text) LIKE ? OR LOWER(COALESCE(tags, '')) LIKE ? OR LOWER(COALESCE(project, '')) LIKE ? OR LOWER(COALESCE(stakeholder, '')) LIKE ?)");
      params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
    }
    sql += " AND (" + termConditions.join(" AND ") + ")";
    if (options.activeOnly !== false) {
      sql += " AND invalidated_at IS NULL";
    }
    if (options.minConfidence) {
      sql += " AND confidence >= ?";
      params.push(options.minConfidence);
    }
    if (options.domain) {
      sql += " AND domain = ?";
      params.push(options.domain);
    }
    sql += " ORDER BY importance DESC, confidence DESC";
    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => this.rowToBelief(row));
  }
  textsShareSubject(a, b) {
    const significant = (s) => {
      const words = s.toLowerCase().replace(/[^\w\s-]/g, "").split(/\s+/).filter(Boolean);
      return new Set(words.filter((w) => !["the", "a", "an", "is", "are", "was", "for", "to", "of", "with", "in", "on", "by", "from", "and", "but", "or", "not", "has", "have", "had", "this", "that"].includes(w) && w.length > 2));
    };
    const wordsA = significant(a);
    const wordsB = significant(b);
    const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
    const minSize = Math.min(wordsA.size, wordsB.size);
    return minSize > 0 && overlap / minSize > 0.3;
  }
  computeInitialConfidence(domain, type) {
    if (domain === "rule" || type === "directive")
      return 0.95;
    if (type === "handoff")
      return 1;
    if (type === "watch")
      return 0.75;
    if (type === "pending")
      return 0.8;
    if (type === "decision")
      return 0.9;
    return 0.85;
  }
  rowToBelief(row) {
    return {
      id: row.id,
      text: row.text,
      domain: row.domain,
      belief_type: row.belief_type,
      confidence: row.confidence,
      importance: row.importance,
      tags: row.tags ? row.tags.startsWith("[") ? JSON.parse(row.tags) : [row.tags] : [],
      project: row.project ?? undefined,
      stakeholder: row.stakeholder ?? undefined,
      verify_by: row.verify_by ?? undefined,
      expires_at: row.expires_at ?? undefined,
      action: row.action ?? undefined,
      source_session: row.source_session ?? undefined,
      derived_at: row.derived_at,
      last_evaluated: row.last_evaluated,
      supersedes_id: row.supersedes_id ?? undefined,
      invalidated_at: row.invalidated_at ?? undefined,
      invalidation_reason: row.invalidation_reason ?? undefined
    };
  }
}
var beliefStore = null;
function getBeliefStore() {
  if (!beliefStore) {
    beliefStore = new BeliefStore;
  }
  return beliefStore;
}

// src/utils/scoring.ts
function autoDetectDomain2(text) {
  if (/\b(NEVER|ALWAYS|MUST|CRITICAL|rule|mandate)\b/i.test(text))
    return "rule";
  if (/\b(HANDOFF|NEXT|resume|session\s+\d+)\b/i.test(text))
    return "handoff";
  if (/\b(verify|regress|watch|fragile|broke\s+again|still\s+works)\b/i.test(text))
    return "watch";
  if (/\b(port|service|nginx|systemd|VPS|server|SSL|DNS)\b/i.test(text))
    return "infra";
  if (/\b(deploy|pipeline|workflow|pattern|architecture)\b/i.test(text))
    return "pattern";
  if (/\b(waiting|asked|request|stakeholder|deliverable)\b/i.test(text))
    return "stakeholder";
  if (/\b(skill|command|tool|hook|plugin)\b/i.test(text))
    return "skill";
  return "project";
}
var STOP_WORDS2 = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "must",
  "on",
  "in",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "into",
  "about",
  "between",
  "through",
  "during",
  "before",
  "after",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "so",
  "yet",
  "both",
  "either",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its"
]);

// src/index.ts
var VALID_DOMAINS = ["handoff", "watch", "project", "stakeholder", "rule", "pattern", "infra", "skill"];
var VALID_TYPES = ["directive", "fact", "handoff", "watch", "decision", "pending"];
var program2 = new Command;
program2.name("mem-reason").description("memr v2 \u2014 Belief-based persistent memory for Claude Code").version("2.0.0");
program2.command("init").description("Initialize .memorai directory").action(() => {
  const dataDir = ensureDataDir();
  getDatabase();
  console.log(`Initialized memory system in ${dataDir}`);
  closeDatabase();
});
program2.command("status").description("Show belief stats").action(() => {
  const config = loadConfig();
  if (!existsSync3(join5(config.dataDir, "memory.db"))) {
    console.log("Memory system not initialized. Run `mem-reason init` first.");
    return;
  }
  const beliefStore2 = getBeliefStore();
  const beliefCount = beliefStore2.count();
  const activeBeliefCount = beliefStore2.count({ activeOnly: true });
  const domainStats = beliefStore2.getStatsPerDomain();
  console.log(`Beliefs: ${activeBeliefCount} active / ${beliefCount} total`);
  if (Object.keys(domainStats).length > 0) {
    console.log(`
Beliefs by domain:`);
    for (const [domain, stats] of Object.entries(domainStats)) {
      console.log(`  ${domain}: ${stats.count} (avg confidence: ${(stats.avgConfidence * 100).toFixed(0)}%)`);
    }
  }
  closeDatabase();
});
program2.command("remember <text>").description("Quick belief add \u2014 auto-detects domain from content").option("-d, --domain <domain>", "Override auto-detected domain").option("-t, --type <type>", "Override auto-detected type").option("-p, --project <name>", "Associate with project").option("-s, --stakeholder <name>", "Associate with stakeholder").option("--tags <tags>", "Comma-separated tags").action((text, options) => {
  const beliefStore2 = getBeliefStore();
  const domain = options.domain || autoDetectDomain2(text);
  const belief = beliefStore2.create({
    text,
    domain,
    belief_type: options.type,
    tags: options.tags ? options.tags.split(",") : undefined,
    project: options.project || undefined,
    stakeholder: options.stakeholder || undefined
  });
  const shortId = belief.id.slice(0, 8);
  console.log(`Remembered: [${belief.domain}/${belief.belief_type}] ${shortId}`);
  closeDatabase();
});
program2.command("check <topic>").description("Quick lookup \u2014 top 3 beliefs about a topic").option("-l, --limit <n>", "Max results", "3").action((topic, options) => {
  const beliefStore2 = getBeliefStore();
  const limit = parseInt(options.limit, 10);
  const results = beliefStore2.check(topic, limit);
  if (results.length === 0) {
    console.log(`(no beliefs about "${topic}")`);
  } else {
    for (const b of results) {
      console.log(`- [${b.domain}] ${b.text}`);
    }
  }
  closeDatabase();
});
program2.command("handoff <text>").description("Session handoff \u2014 auto-supersedes previous handoffs").option("-n, --session <n>", "Session number").action((text, options) => {
  const beliefStore2 = getBeliefStore();
  const sessionNumber = options.session ? parseInt(options.session, 10) : undefined;
  const previousCount = beliefStore2.getActive({ domain: "handoff" }).length;
  const belief = beliefStore2.createHandoff(text, sessionNumber);
  const shortId = belief.id.slice(0, 8);
  console.log(`Handoff saved: ${shortId} (${previousCount} previous handoffs superseded)`);
  closeDatabase();
});
program2.command("curate").description("Auto-cleanup: decay, dedup, expire, cap").option("--dry-run", "Show what would change without modifying").action((options) => {
  const beliefStore2 = getBeliefStore();
  const dryRun = !!options.dryRun;
  const stats = beliefStore2.curate(dryRun);
  const resolved = stats.resolved ?? 0;
  const total = stats.expired + stats.decayed + stats.merged + stats.capped + stats.invalidated + resolved;
  const prefix = dryRun ? "[DRY RUN] " : "";
  console.log(`${prefix}Curate results:`);
  console.log(`  Expired:      ${stats.expired}`);
  console.log(`  Decayed:      ${stats.decayed}`);
  console.log(`  Merged:       ${stats.merged}`);
  console.log(`  Capped:       ${stats.capped}`);
  console.log(`  Invalidated:  ${stats.invalidated}`);
  console.log(`  Resolved:     ${resolved}`);
  console.log(`  Total:        ${total}`);
  closeDatabase();
});
program2.command("orient").description("Compact session-start context").action(() => {
  const beliefStore2 = getBeliefStore();
  const output = beliefStore2.orient();
  console.log(output);
  closeDatabase();
});
program2.command("verify <id>").description("Mark a watch belief as verified").action((id) => {
  const beliefStore2 = getBeliefStore();
  const belief = beliefStore2.getById(id);
  if (!belief) {
    console.log(`Belief not found: ${id}`);
    closeDatabase();
    return;
  }
  const newConf = Math.min(1, belief.confidence + 0.1);
  const updated = beliefStore2.update(id, {
    confidence: newConf,
    last_evaluated: Date.now()
  });
  if (updated) {
    console.log(`Verified: ${id}`);
    console.log(`  Confidence: ${(updated.confidence * 100).toFixed(0)}%`);
  }
  closeDatabase();
});
program2.command("add-belief").description("Add a belief with explicit control over all fields").requiredOption("-t, --text <text>", "Belief text").requiredOption("-d, --domain <domain>", `Domain: ${VALID_DOMAINS.join(", ")}`).option("-c, --confidence <n>", "Confidence 0-1", "0.7").option("-i, --importance <n>", "Importance 1-5", "3").option("--type <type>", `Belief type: ${VALID_TYPES.join(", ")}`).option("--tags <tags>", "Comma-separated tags").option("-p, --project <name>", "Project name").option("-s, --stakeholder <name>", "Stakeholder name").action((options) => {
  const beliefStore2 = getBeliefStore();
  const belief = beliefStore2.create({
    text: options.text,
    domain: options.domain,
    belief_type: options.type,
    confidence: parseFloat(options.confidence),
    importance: parseInt(options.importance, 10),
    tags: options.tags ? options.tags.split(",") : [],
    project: options.project || undefined,
    stakeholder: options.stakeholder || undefined
  });
  console.log(`Added belief: ${belief.id}`);
  console.log(`  "${belief.text}"`);
  closeDatabase();
});
program2.command("search <query>").description("Search beliefs").option("-l, --limit <n>", "Max results", "10").option("-d, --domain <domain>", "Filter by domain").action((query, options) => {
  const beliefStore2 = getBeliefStore();
  const limit = parseInt(options.limit, 10);
  const beliefs = beliefStore2.search(query, {
    limit,
    domain: options.domain,
    activeOnly: true
  });
  if (beliefs.length === 0) {
    console.log("(no matching beliefs)");
  } else {
    for (const b of beliefs) {
      console.log(`[${b.domain}] (${(b.confidence * 100).toFixed(0)}%) ${b.text}`);
      console.log(`  ID: ${b.id}`);
    }
  }
  closeDatabase();
});
program2.command("beliefs").description("List active beliefs").option("-d, --domain <domain>", "Filter by domain").option("-l, --limit <n>", "Max results", "20").option("--json", "Output as JSON").action((options) => {
  const beliefStore2 = getBeliefStore();
  const beliefs = beliefStore2.getActive({
    domain: options.domain,
    limit: parseInt(options.limit, 10)
  });
  if (options.json) {
    console.log(JSON.stringify(beliefs, null, 2));
  } else if (beliefs.length === 0) {
    console.log("No active beliefs.");
  } else {
    const byDomain = {};
    for (const b of beliefs) {
      if (!byDomain[b.domain])
        byDomain[b.domain] = [];
      byDomain[b.domain].push(b);
    }
    for (const [domain, domainBeliefs] of Object.entries(byDomain)) {
      console.log(`
=== ${domain.toUpperCase()} ===`);
      for (const b of domainBeliefs) {
        const typeTag = b.belief_type ? `/${b.belief_type}` : "";
        console.log(`[${(b.confidence * 100).toFixed(0)}%] ${b.text} (${domain}${typeTag})`);
        console.log(`  ID: ${b.id}`);
      }
    }
  }
  closeDatabase();
});
program2.command("update-belief <id>").description("Update a belief").option("-c, --confidence <n>", "New confidence 0-1").option("-i, --importance <n>", "New importance 1-5").action((id, options) => {
  const beliefStore2 = getBeliefStore();
  const changes = {};
  if (options.confidence)
    changes.confidence = parseFloat(options.confidence);
  if (options.importance)
    changes.importance = parseInt(options.importance, 10);
  changes.last_evaluated = Date.now();
  const updated = beliefStore2.update(id, changes);
  if (updated) {
    console.log(`Updated belief: ${id}`);
    console.log(`  Confidence: ${(updated.confidence * 100).toFixed(0)}%`);
  } else {
    console.log(`Belief not found: ${id}`);
  }
  closeDatabase();
});
program2.command("invalidate <id>").description("Invalidate a belief").requiredOption("-r, --reason <text>", "Reason for invalidation").action((id, options) => {
  const beliefStore2 = getBeliefStore();
  const success = beliefStore2.invalidate(id, options.reason);
  if (success) {
    console.log(`Invalidated belief: ${id}`);
  } else {
    console.log(`Belief not found or already invalidated: ${id}`);
  }
  closeDatabase();
});
program2.command("context").description("Full memory context for injection").option("-l, --limit <n>", "Token budget", "8000").action((options) => {
  const beliefStore2 = getBeliefStore();
  const tokenBudget = parseInt(options.limit, 10);
  const scored = beliefStore2.getContextBeliefs({
    tokenBudget,
    sessionType: "interactive"
  });
  if (scored.length === 0) {
    console.log("(no stored beliefs yet)");
    closeDatabase();
    return;
  }
  const beliefs = scored.map((s) => s.belief);
  const usedTokens = scored.reduce((sum, s) => sum + s.estimatedTokens, 0);
  console.log(`## Memory Context
`);
  const byDomain = {};
  for (const b of beliefs) {
    if (!byDomain[b.domain])
      byDomain[b.domain] = [];
    byDomain[b.domain].push(b);
  }
  for (const [domain, domainBeliefs] of Object.entries(byDomain)) {
    console.log(`### ${domain}`);
    for (const b of domainBeliefs) {
      console.log(`- ${b.text}`);
    }
    console.log("");
  }
  console.log(`[${beliefs.length} beliefs / ~${usedTokens} tokens]`);
  closeDatabase();
});
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match)
    return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split(`
`)) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) {
      meta[key.trim()] = rest.join(":").trim();
    }
  }
  return { meta, body: match[2].trim() };
}
function memoryTypeToDomain(type) {
  switch (type) {
    case "feedback":
      return "rule";
    case "user":
      return "rule";
    case "project":
      return "project";
    case "reference":
      return "infra";
    default:
      return "project";
  }
}
function stripMarkdown(text) {
  return text.replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/```[\s\S]*?```/g, "").replace(/^\s*[-*]\s+/gm, "- ").replace(/\n{3,}/g, `

`).trim();
}
function extractBeliefText(body, description) {
  const cleaned = stripMarkdown(body);
  if (!cleaned)
    return description.slice(0, 500);
  const whyMatch = cleaned.match(/Why:([\s\S]*?)(?=How to apply:|$)/i);
  const howMatch = cleaned.match(/How to apply:([\s\S]*?)$/i);
  if (whyMatch && howMatch) {
    const core = cleaned.split(/\n*Why:/i)[0].trim();
    const why = whyMatch[1].trim();
    const how = howMatch[1].trim();
    const compact = `${core} | Why: ${why} | How: ${how}`;
    if (compact.length <= 500)
      return compact;
  }
  const paragraphs = cleaned.split(/\n\n/);
  let result = paragraphs[0];
  for (let i = 1;i < paragraphs.length; i++) {
    const candidate = result + " " + paragraphs[i];
    if (candidate.length > 400)
      break;
    result = candidate;
  }
  if (result.length > 500) {
    result = result.slice(0, 497) + "...";
  }
  return result;
}
program2.command("import-memories <dir>").description("Import auto-memory .md files into memr beliefs").option("--dry-run", "Show what would be imported without modifying").option("--force", "Import even if duplicates detected").action((dir, options) => {
  const resolvedDir = dir.startsWith("/") ? dir : join5(process.cwd(), dir);
  if (!existsSync3(resolvedDir)) {
    console.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }
  const files = readdirSync(resolvedDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  if (files.length === 0) {
    console.log("No .md files found (excluding MEMORY.md).");
    return;
  }
  const dryRun = !!options.dryRun;
  const force = !!options.force;
  if (!dryRun) {
    const config = loadConfig();
    if (!existsSync3(join5(config.dataDir, "memory.db"))) {
      console.error("Memory system not initialized. Run `mem-reason init` first.");
      process.exit(1);
    }
  }
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const beliefStore2 = dryRun ? null : getBeliefStore();
  for (const file of files) {
    const filePath = join5(resolvedDir, file);
    try {
      const content = readFileSync3(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(content);
      const name = meta.name || basename(file, ".md");
      const description = meta.description || "";
      const type = meta.type || "project";
      const domain = memoryTypeToDomain(type);
      const beliefText = extractBeliefText(body, description);
      if (!beliefText) {
        console.log(`  SKIP (empty): ${file}`);
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`  [${domain}] ${file} \u2192 "${beliefText.slice(0, 80)}${beliefText.length > 80 ? "..." : ""}"`);
        imported++;
        continue;
      }
      if (!force) {
        const existing = beliefStore2.findDuplicate(beliefText, domain, 0.7);
        if (existing) {
          console.log(`  SKIP (duplicate): ${file} \u2192 matches ${existing.id.slice(0, 8)}`);
          skipped++;
          continue;
        }
      }
      const belief = beliefStore2.create({
        text: beliefText,
        domain,
        tags: ["imported", `source:${basename(file, ".md")}`]
      });
      console.log(`  OK: ${file} \u2192 [${belief.domain}/${belief.belief_type}] ${belief.id.slice(0, 8)}`);
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${file} \u2192 ${msg}`);
      errors++;
    }
  }
  const prefix = dryRun ? "[DRY RUN] " : "";
  console.log(`
${prefix}Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors (from ${files.length} files)`);
  if (!dryRun)
    closeDatabase();
});
function getEmbeddedHook() {
  const lines = [
    "#!/usr/bin/env bash",
    "# memr SessionStart hook \u2014 generic, project-agnostic",
    "# Provides belief context and active recall protocol at session start.",
    "# Install: mem-reason setup  (auto-registers this hook)",
    "",
    "set -euo pipefail",
    "",
    "# \u2500\u2500 Curate beliefs silently (non-blocking) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "mem-reason curate >/dev/null 2>&1 &",
    "",
    "# \u2500\u2500 Orient: get compact belief context \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    'orient_output=""',
    "if command -v mem-reason >/dev/null 2>&1; then",
    "  orient_output=$(mem-reason orient 2>/dev/null || true)",
    "fi",
    "",
    "# \u2500\u2500 Build context block \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "read -r -d '' CONTEXT_BLOCK << 'MEMR_EOF' || true",
    "## Active Recall Protocol",
    "",
    "You have a persistent belief store via `mem-reason`. Use it throughout this session:",
    "",
    "### Retrieve before acting",
    '- Before starting any task, run `mem-reason check "<topic>"` to recall relevant beliefs.',
    "- At session start, review `mem-reason orient` output (included below) for current context.",
    "",
    "### Store before ending",
    "- Before this session ends, encode any new lessons, decisions, or handoffs:",
    '  - `mem-reason remember "<lesson>"` for quick storage',
    '  - `mem-reason handoff "<state>"` for session continuity',
    "- If something broke and you fixed it, store the lesson as a belief.",
    "",
    "### Commands reference",
    "- `mem-reason check <topic>` \u2014 quick lookup (top 3)",
    "- `mem-reason remember <text>` \u2014 store a new belief",
    "- `mem-reason handoff <text>` \u2014 session handoff (auto-supersedes previous)",
    "- `mem-reason search <query>` \u2014 full-text search",
    "- `mem-reason beliefs` \u2014 list all active beliefs",
    "- `mem-reason curate` \u2014 auto-cleanup (decay, dedup, expire)",
    "MEMR_EOF",
    "",
    "# Append orient output if non-empty",
    'if [ -n "$orient_output" ]; then',
    '  CONTEXT_BLOCK="${CONTEXT_BLOCK}',
    "",
    "## Current Belief Context",
    '$orient_output"',
    "fi",
    "",
    "# \u2500\u2500 Output as Claude Code hook JSON \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "if command -v jq >/dev/null 2>&1; then",
    `  jq -n --arg ctx "$CONTEXT_BLOCK" '{`,
    "    hookSpecificOutput: {",
    '      hookEventName: "SessionStart",',
    "      additionalContext: $ctx",
    "    }",
    "  }'",
    "else",
    "  # Manual JSON escaping fallback",
    `  escaped=$(printf '%s' "$CONTEXT_BLOCK" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g; s/\\t/\\\\t/g' | awk '{printf "%s\\\\n", $0}' | sed 's/\\\\n$//')`,
    `  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\\n' "$escaped"`,
    "fi"
  ];
  return lines.join(`
`) + `
`;
}
program2.command("setup").description("Set up memr in current project \u2014 init beliefs, install SessionStart hook").action(() => {
  const projectDir = process.cwd();
  console.log("1. Initializing .memorai/ ...");
  const dataDir = ensureDataDir(projectDir);
  getDatabase();
  closeDatabase();
  console.log(`   Created: ${dataDir}`);
  const hooksDir = join5(projectDir, ".claude", "hooks");
  if (!existsSync3(hooksDir)) {
    mkdirSync3(hooksDir, { recursive: true });
  }
  const hookPath = join5(hooksDir, "memr-session-start.sh");
  console.log("2. Writing hook: .claude/hooks/memr-session-start.sh ...");
  writeFileSync3(hookPath, getEmbeddedHook(), { mode: 493 });
  console.log(`   Created: ${hookPath}`);
  const settingsPath = join5(projectDir, ".claude", "settings.json");
  console.log("3. Configuring .claude/settings.json ...");
  const memrHookEntry = {
    hooks: [
      {
        type: "command",
        command: "bash .claude/hooks/memr-session-start.sh"
      }
    ]
  };
  let settings = {};
  if (existsSync3(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync3(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }
  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }
  const hooks = settings.hooks;
  if (!Array.isArray(hooks.SessionStart)) {
    hooks.SessionStart = [];
  }
  const alreadyRegistered = hooks.SessionStart.some((entry) => {
    if (typeof entry !== "object" || entry === null)
      return false;
    const e = entry;
    if (!Array.isArray(e.hooks))
      return false;
    return e.hooks.some((h) => {
      if (typeof h !== "object" || h === null)
        return false;
      const hObj = h;
      return hObj.type === "command" && typeof hObj.command === "string" && hObj.command.includes("memr-session-start.sh");
    });
  });
  if (alreadyRegistered) {
    console.log("   Hook already registered (skipped duplicate).");
  } else {
    hooks.SessionStart.push(memrHookEntry);
    console.log("   Registered SessionStart hook.");
  }
  writeFileSync3(settingsPath, JSON.stringify(settings, null, 2) + `
`);
  console.log(`   Updated: ${settingsPath}`);
  console.log(`
--- memr setup complete ---`);
  console.log(`Project: ${projectDir}`);
  console.log("Verify with:");
  console.log("  cat .claude/settings.json");
  console.log("  bash .claude/hooks/memr-session-start.sh | jq .");
  console.log("  mem-reason status");
});
program2.parse();
