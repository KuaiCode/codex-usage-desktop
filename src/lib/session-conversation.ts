import type { SessionReplayDetail } from "./api";

const EXEC_TOOL_NAMES = new Set(["exec", "exec_command"]);

export type ReplayItem = SessionReplayDetail["turns"][number]["items"][number];
export type TokenUsageItem = Extract<ReplayItem, { kind: "tokenUsage" }>;
export type DisplayTokenUsageItem = TokenUsageItem & { deltaTokens?: number };

export type TimelineEntry = {
  item: ReplayItem;
  tokenUsage?: DisplayTokenUsageItem;
  activity?: ToolActivity;
};

function orderedItems(turn: SessionReplayDetail["turns"][number]): ReplayItem[] {
  if (turn.items?.length) return turn.items;
  return [
    ...turn.systemMessages.map((message) => ({ kind: "message" as const, timestamp: message.timestamp, role: "system", source: message.kind, text: message.text })),
    ...turn.userMessages.map((message) => ({ kind: "message" as const, timestamp: message.timestamp, role: "user", source: message.kind, text: message.text })),
    ...turn.assistantMessages.map((message) => ({ kind: "message" as const, timestamp: message.timestamp, role: "assistant", source: message.kind, text: message.text })),
    ...turn.reasoningSummaries.map((message) => ({ kind: "reasoning" as const, timestamp: message.timestamp, text: message.text })),
    ...turn.toolCalls.map((tool) => ({ kind: "toolCall" as const, ...tool })),
    ...turn.patchResults.map((patch) => ({ kind: "patch" as const, ...patch })),
    ...turn.tokenEvents.map((usage) => ({ kind: "tokenUsage" as const, ...usage })),
    ...turn.errors.map((text) => ({ kind: "error" as const, timestamp: null, text })),
  ];
}

function isVisibleTimelineItem(item: ReplayItem) {
  return item.kind !== "patch" || item.isError || item.success === false;
}

function timelineEntries(items: ReplayItem[], previousTotalTokens: { value?: number }): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const item of items) {
    if (item.kind === "tokenUsage") {
      const tokenUsage = {
        ...item,
        deltaTokens: previousTotalTokens.value === undefined ? undefined : item.totalTokens - previousTotalTokens.value,
      };
      previousTotalTokens.value = item.totalTokens;
      const previousEntry = entries.findLast((entry) => isVisibleTimelineItem(entry.item));
      if (previousEntry) {
        previousEntry.tokenUsage = tokenUsage;
        continue;
      }
      entries.push({ item: tokenUsage });
      continue;
    }
    entries.push({ item, activity: item.kind === "toolCall" ? buildToolActivity(item) : undefined });
  }

  return entries;
}


type ExecArguments = {
  command: string;
  workdir: string | null;
  kind: "command" | "patch";
};

export type ExecOutput = {
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  wallTimeSeconds: number | null;
  sessionId: string | number | null;
  rejected?: boolean;
};

type ToolContentBlocks = {
  text: string | null;
  texts: string[];
  images: string[];
};

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}(?:[@-Z\\-_]|\\[[0-?]*[ -/]*[@-~])`, "g");

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function baseToolName(name: string) {
  return name.split(".").at(-1) ?? name;
}

export function formatToolArgumentValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

export function formatJsonForDisplay(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : text;
  } catch {
    return text;
  }
}

function parseNestedToolCall(value: string, toolName: string) {
  const call = scanToolScript(value).calls.find((call) => call.name === toolName);
  if (!call) return null;
  const whitespace = value.slice(call.argumentStart).match(/^\s*/)?.[0].length ?? 0;
  const objectStart = call.argumentStart + whitespace;
  if (value[objectStart] !== "{") return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let index = objectStart; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') inString = true;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const objectLiteral = value.slice(objectStart, index + 1);
        const parsed = parseJsonObject(objectLiteral);
        if (parsed) return parsed;

        let normalized = "";
        let normalizedInString = false;
        let normalizedIsEscaped = false;
        for (let literalIndex = 0; literalIndex < objectLiteral.length; literalIndex += 1) {
          const literalCharacter = objectLiteral[literalIndex];
          normalized += literalCharacter;

          if (normalizedInString) {
            if (normalizedIsEscaped) {
              normalizedIsEscaped = false;
            } else if (literalCharacter === "\\") {
              normalizedIsEscaped = true;
            } else if (literalCharacter === '"') {
              normalizedInString = false;
            }
            continue;
          }

          if (literalCharacter === '"') {
            normalizedInString = true;
            continue;
          }
          if (literalCharacter !== "{" && literalCharacter !== ",") continue;

          const property = objectLiteral.slice(literalIndex + 1).match(/^(\s*)([A-Za-z_$][\w$]*)(\s*:)/);
          if (!property) continue;
          normalized += `${property[1]}"${property[2]}"${property[3]}`;
          literalIndex += property[0].length;
        }

        return parseJsonObject(normalized);
      }
    }
  }

  return null;
}

function parseBackgroundTerminalInput(value: string | null, outerToolName: string, parsedArguments: Record<string, unknown> | null) {
  if (outerToolName === "write_stdin") {
    if (!parsedArguments || (parsedArguments.chars !== undefined && typeof parsedArguments.chars !== "string")) return null;
    return typeof parsedArguments.chars === "string" ? parsedArguments.chars : "";
  }
  if (!EXEC_TOOL_NAMES.has(outerToolName) || !value) return null;
  const { calls, dynamic } = scanToolScript(value);
  if (dynamic || calls.length !== 1 || calls[0].name !== "write_stdin") return null;

  const nestedArguments = parseNestedToolCall(value, "write_stdin");
  if (!nestedArguments || (nestedArguments.chars !== undefined && typeof nestedArguments.chars !== "string")) return null;
  return typeof nestedArguments.chars === "string" ? nestedArguments.chars : "";
}

function parseExecArguments(value: string | null): ExecArguments | null {
  const parsed = parseJsonObject(value) ?? (value ? parseNestedToolCall(value, "exec_command") : null);
  if (parsed) {
    const command = typeof parsed.cmd === "string"
      ? parsed.cmd
      : typeof parsed.command === "string"
        ? parsed.command
        : null;
    if (!command) return null;

    const workdir = typeof parsed.workdir === "string"
      ? parsed.workdir
      : typeof parsed.cwd === "string"
        ? parsed.cwd
        : null;
    return { command, workdir, kind: "command" };
  }

  if (!value) return null;
  const assignment = value.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:\\.|[^"\\])*")\s*;/s);
  if (!assignment || !value.includes(`tools.apply_patch(${assignment[1]})`)) return null;

  try {
    const patch = JSON.parse(assignment[2]);
    return typeof patch === "string" ? { command: patch, workdir: null, kind: "patch" } : null;
  } catch {
    return null;
  }
}

function parseWebSearchQueries(value: string | null) {
  if (!value) return null;
  const parsed = parseNestedToolCall(value, "web__run");
  if (!parsed || !Array.isArray(parsed.search_query)) return null;

  const queries = parsed.search_query.flatMap((entry) => (
    entry && typeof entry === "object" && typeof (entry as { q?: unknown }).q === "string"
      ? [(entry as { q: string }).q]
      : []
  ));
  return queries.length > 0 ? queries : null;
}

export function splitWebSearchResults(text: string) {
  return cleanExecOutput(text)
    .split(/-{10,}/)
    .map((result) => result.trim())
    .filter(Boolean);
}

export type WebSearchResult = {
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string | null;
};

function parseWebSearchResultCards(value: string | null): WebSearchResult[] | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const results = parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const result = entry as Record<string, unknown>;
      if (result.type !== "text_result" || typeof result.title !== "string") return [];
      return [{
        title: result.title,
        url: typeof result.url === "string" ? result.url : null,
        domain: typeof result.domain === "string" ? result.domain : null,
        snippet: typeof result.snippet === "string" ? result.snippet : null,
      }];
    });
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

export function parseToolContentBlocks(value: string | null): ToolContentBlocks | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const texts: string[] = [];
    const images: string[] = [];

    for (const block of parsed) {
      if (block === null || typeof block !== "object") return null;
      const content = block as Record<string, unknown>;
      if (typeof content.text === "string") {
        texts.push(content.text);
      } else if (typeof content.image_url === "string") {
        images.push(content.image_url);
      } else {
        return null;
      }
    }

    const text = texts.join("\n");
    return text || images.length > 0 ? { text: text || null, texts, images } : null;
  } catch {
    return null;
  }
}

export type NestedActivity =
  | { kind: "command"; command: string; workdir: string | null; output: ExecOutput | null }
  | { kind: "terminal"; input: string; sessionId: string | number; output: ExecOutput | null }
  | { kind: "patch"; patch: string }
  | { kind: "image"; path: string; imageUrl: string | null };

function parseStringArgument(value: string, callStart: number) {
  const argument = value.slice(callStart).match(/^\s*("(?:\\.|[^"\\])*")/s)?.[1];
  if (!argument) return null;
  try {
    const parsed: unknown = JSON.parse(argument);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveStringVariable(value: string, callStart: number) {
  const name = value.slice(callStart).match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (!name) return null;
  const declarations = [...value.slice(0, callStart).matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:\\.|[^"\\])*")\s*;/gs)];
  const declaration = declarations.findLast((match) => match[1] === name);
  if (!declaration) return null;
  try {
    const parsed: unknown = JSON.parse(declaration[2]);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function execResultsFromContent(content: ToolContentBlocks | null, output: string | null) {
  const results = new Map<number, ExecOutput | null>();
  const outputs: Array<{ index: number; result: ExecOutput }> = [];
  const unparsed: string[] = [];
  let nextIndex = 0;
  let allIndexed = true;
  let duplicateIndices = false;
  for (const text of content?.texts ?? (output ? [output] : [])) {
    const candidates = parseJsonObject(text) ? [text] : text.split("\n");
    for (const candidate of candidates) {
      const value = parseJsonObject(candidate.trim());
      const result = value?.status === "fulfilled" ? value.value : value;
      const parsed = value?.status === "rejected"
        ? { stdout: null, stderr: formatToolArgumentValue(value.reason ?? "Rejected"), exitCode: null, wallTimeSeconds: null, sessionId: null, rejected: true }
        : result && typeof result === "object" && !Array.isArray(result)
          ? parseExecOutput(JSON.stringify(result))
          : null;
      const index = typeof value?.i === "number" && Number.isInteger(value.i) && value.i >= 0
        ? value.i : null;
      if (parsed) {
        if (index === null) allIndexed = false;
        const resultIndex = index ?? nextIndex;
        if (results.has(resultIndex)) duplicateIndices = true;
        results.set(resultIndex, parsed);
        outputs.push({ index: resultIndex, result: parsed });
        nextIndex = resultIndex + 1;
      } else {
        const cleaned = cleanExecOutput(candidate);
        if ((cleaned && cleaned !== "{}") || candidate.trim() === "") unparsed.push(candidate);
        // Retain the slot of a truncated result so later responses cannot shift.
        if (/^\s*\{.*"(?:output|stdout|value)"\s*:/.test(candidate)) {
          const truncatedIndex = candidate.match(/^\s*\{\s*"i"\s*:\s*(\d+)/)?.[1];
          if (!truncatedIndex) allIndexed = false;
          const resultIndex = truncatedIndex ? Number(truncatedIndex) : nextIndex;
          results.set(resultIndex, null);
          nextIndex = resultIndex + 1;
        }
      }
    }
  }
  return { results, outputs, allIndexed, duplicateIndices, unparsedOutputText: cleanExecOutput(unparsed.join("\n")) || null };
}

function scanToolScript(value: string) {
  const calls: Array<{ name: string; index: number; argumentStart: number }> = [];
  let code = "";
  let uncertainSyntax = false;
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      if (character === "`") uncertainSyntax = true;
      quote = character;
      code += " ";
      continue;
    }
    if (value.startsWith("//", index)) {
      const end = value.indexOf("\n", index + 2);
      index = end < 0 ? value.length : end - 1;
      continue;
    }
    if (value.startsWith("/*", index)) {
      const end = value.indexOf("*/", index + 2);
      index = end < 0 ? value.length : end + 1;
      code += " ";
      continue;
    }
    code += character;
    if (character === "/") uncertainSyntax = true;
    if (index > 0 && /[\w$.]/.test(value[index - 1])) continue;
    const match = value.slice(index).match(/^tools\.([A-Za-z_$][\w$]*)\s*\(/);
    if (!match) continue;
    calls.push({ name: match[1], index, argumentStart: index + match[0].length });
  }
  // Source order is not execution order inside callbacks, branches or loops.
  const dynamic = /=>|&&|\|\||\?(?![.?])|\b(?:for|while|if|switch|function)\b|\bPromise\s*\.\s*(?:all|allSettled|race|any)\s*\(/.test(code);
  return { calls, dynamic: dynamic || uncertainSyntax };
}

function parseNestedActivities(value: string | null, output: string | null) {
  if (!value) return null;
  const { calls, dynamic } = scanToolScript(value);
  if (dynamic || calls.some((call) => !["exec_command", "write_stdin", "apply_patch", "view_image"].includes(call.name))
    || calls.filter((call) => call.name === "view_image").length > 1
    || !calls.some((call) => call.name !== "write_stdin")
    || (calls.length === 1 && calls[0].name === "exec_command")) return null;
  const content = parseToolContentBlocks(output);
  const { results: execResults, outputs, allIndexed, duplicateIndices, unparsedOutputText } = execResultsFromContent(content, output);
  const processCount = calls.filter((call) => call.name === "exec_command" || call.name === "write_stdin").length;
  const emittedInOrder = calls.filter((call) => call.name === "exec_command" || call.name === "write_stdin")
    .every((call) => /\btext\s*\(\s*await\s*$/.test(value.slice(0, call.index)));
  const canPairResults = !duplicateIndices && ((allIndexed && processCount === calls.length)
    || (!allIndexed && emittedInOrder && execResults.size === processCount));
  const pairedResults = canPairResults ? execResults : new Map<number, ExecOutput | null>();
  let execIndex = 0;
  let imageIndex = 0;
  const activities: NestedActivity[] = [];
  for (const call of calls) {
    const { name, index: callIndex, argumentStart } = call;
    if (name === "exec_command") {
      const parsed = parseNestedToolCall(value.slice(callIndex), name);
      const command = typeof parsed?.cmd === "string" ? parsed.cmd : typeof parsed?.command === "string" ? parsed.command : null;
      if (!command) return null;
      const workdir = typeof parsed?.workdir === "string" ? parsed.workdir : typeof parsed?.cwd === "string" ? parsed.cwd : null;
      activities.push({ kind: "command", command, workdir, output: pairedResults.get(execIndex++) ?? null });
    } else if (name === "write_stdin") {
      const parsed = parseNestedToolCall(value.slice(callIndex), name);
      if (typeof parsed?.session_id !== "number" && typeof parsed?.session_id !== "string") return null;
      if (parsed.chars !== undefined && typeof parsed.chars !== "string") return null;
      activities.push({ kind: "terminal", input: typeof parsed.chars === "string" ? parsed.chars : "", sessionId: parsed.session_id, output: pairedResults.get(execIndex++) ?? null });
    } else if (name === "apply_patch") {
      const patch = parseStringArgument(value, argumentStart) ?? resolveStringVariable(value, argumentStart);
      if (!patch) return null;
      activities.push({ kind: "patch", patch });
    } else {
      const parsed = parseNestedToolCall(value.slice(callIndex), name);
      if (typeof parsed?.path === "string") {
        activities.push({ kind: "image", path: parsed.path, imageUrl: content?.images[imageIndex++] ?? null });
      } else return null;
    }
  }

  return activities.length > 0 && (calls.length > 1 || activities.some((activity) => activity.kind !== "command"))
    ? { activities, unparsedOutputText, unpairedOutputs: outputs.filter(({ index }) => !canPairResults || index >= execIndex).map(({ result }) => result) } : null;
}

function parseExecOutput(value: string | null): ExecOutput | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;

  const stdout = typeof parsed.output === "string"
    ? parsed.output
    : typeof parsed.stdout === "string"
      ? parsed.stdout
      : null;
  const stderr = typeof parsed.stderr === "string" ? parsed.stderr : null;
  const exitCode = typeof parsed.exit_code === "number" ? parsed.exit_code : null;
  const wallTimeSeconds = typeof parsed.wall_time_seconds === "number" ? parsed.wall_time_seconds : null;
  const sessionId = typeof parsed.session_id === "string" || typeof parsed.session_id === "number"
    ? parsed.session_id
    : null;

  return stdout !== null || stderr !== null || exitCode !== null || wallTimeSeconds !== null || sessionId !== null
    ? { stdout, stderr, exitCode, wallTimeSeconds, sessionId }
    : null;
}

export function cleanExecOutput(text: string) {
  return text
    .replaceAll("\r\n", "\n")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replaceAll("\r", "")
    .split("\n")
    .filter((line) => !/^Script (?:running with cell ID .+|completed)$/.test(line)
      && !/^(?:Wall|Wait) time [^\r\n]+$/.test(line)
      && !/^Process (?:exited with code -?\d+|stopped with signal SIG[A-Z]+)$/.test(line)
      && line !== "Output:")
    .join("\n")
    .trim();
}

function isEmptyExecOutput(text: string | null) {
  if (!text) return true;
  const cleaned = cleanExecOutput(text).trim();
  return cleaned === "" || cleaned === "{}";
}

export type UserInputQuestion = {
  header: string;
  id: string;
  question: string;
  options: Array<{ label: string; description: string }>;
};

export function formatActivityDuration(ms: number | null) {
  if (ms === null) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

export function processExitCode(output: string | null, isError: boolean) {
  if (output) {
    const canonicalCodes = [...output.matchAll(/^Process exited with code (-?\d+)$/gim)]
      .map((match) => Number(match[1]));
    if (canonicalCodes.length > 0) return canonicalCodes.at(-1)!;

    const structuredCode = parseExecOutput(output)?.exitCode;
    if (structuredCode != null) return structuredCode;

    const codes = [...output.matchAll(/^(?:exit code:\s*|command failed with exit code\s+)(-?\d+)\.?$/gim)]
      .map((match) => Number(match[1]));
    if (codes.length > 0) {
      const nonzeroCodes = codes.filter((code) => code !== 0);
      return Math.max(...(nonzeroCodes.length > 0 ? nonzeroCodes : codes));
    }
  }
  return isError ? 1 : 0;
}

export function processSignal(output: string | null) {
  return output?.match(/Process stopped with signal (SIG[A-Z]+)/)?.[1] ?? null;
}


function parseUserInputQuestions(argumentsJson: string | null, isAsync: boolean): UserInputQuestion[] | null {
  if (!argumentsJson) return null;

  try {
    const parsed = JSON.parse(argumentsJson) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return null;

    if (isAsync) {
      const questions = parsed.questions.flatMap((question, index): UserInputQuestion[] => {
        if (!question || typeof question !== "object") return [];
        const value = question as { title?: unknown; options?: unknown };
        if (typeof value.title !== "string"
          || (value.options !== undefined && (!Array.isArray(value.options)
            || !value.options.every((option) => typeof option === "string")))) return [];
        return [{
          header: "",
          id: `async-question-${index}`,
          question: value.title,
          options: ((value.options ?? []) as string[]).map((label) => ({ label, description: "" })),
        }];
      });
      return questions.length > 0 ? questions : null;
    }

    const questions = parsed.questions.filter((question): question is UserInputQuestion => {
      if (!question || typeof question !== "object") return false;
      const value = question as Partial<UserInputQuestion>;
      return typeof value.header === "string"
        && typeof value.id === "string"
        && typeof value.question === "string"
        && Array.isArray(value.options)
        && value.options.every((option) => option
          && typeof option === "object"
          && typeof option.label === "string"
          && typeof option.description === "string");
    });

    return questions.length > 0 ? questions : null;
  } catch {
    return null;
  }
}

export function parseUserInputAnswers(outputJson: string | null): Record<string, string[]> {
  if (!outputJson) return {};

  try {
    const parsed = JSON.parse(outputJson) as { answers?: Record<string, { answers?: unknown }> };
    if (!parsed.answers || typeof parsed.answers !== "object") return {};
    return Object.fromEntries(Object.entries(parsed.answers).flatMap(([id, answer]) => (
      Array.isArray(answer?.answers) && answer.answers.every((value) => typeof value === "string")
        ? [[id, answer.answers]]
        : []
    )));
  } catch {
    return {};
  }
}


function buildToolActivity(item: Extract<ReplayItem, { kind: "toolCall" }>) {
  const outerToolName = baseToolName(item.name);
  const isExec = EXEC_TOOL_NAMES.has(outerToolName);
  const script = isExec && item.arguments ? scanToolScript(item.arguments) : null;
  const singleCall = script && !script.dynamic && script.calls.length === 1 ? script.calls[0] : null;
  const nestedWriteStdinArguments = singleCall?.name === "write_stdin" && item.arguments
    ? parseNestedToolCall(item.arguments, "write_stdin")
    : null;
  const toolName = nestedWriteStdinArguments ? "write_stdin" : outerToolName;
  const parsedArguments = nestedWriteStdinArguments ?? parseJsonObject(item.arguments);
  const backgroundTerminalInput = parseBackgroundTerminalInput(item.arguments, outerToolName, parsedArguments);
  const userInputQuestions = toolName === "request_user_input" || toolName === "request_user_input_async"
    ? parseUserInputQuestions(item.arguments, toolName === "request_user_input_async") : null;
  const webSearchQueries = singleCall?.name === "web__run"
    ? parseWebSearchQueries(item.arguments)
    : outerToolName === "web_search" && typeof parsedArguments?.q === "string"
      ? [parsedArguments.q]
      : null;
  const webSearchResults = parseWebSearchResultCards(item.output);
  const execArguments = isExec && (!script?.calls.length || singleCall?.name === "exec_command" || singleCall?.name === "apply_patch")
    && !script?.dynamic ? parseExecArguments(item.arguments) : null;
  const argumentEntries = parsedArguments
    ? Object.entries(parsedArguments).filter(([key]) => !execArguments || !["cmd", "command", "workdir", "cwd"].includes(key))
    : [];
  const execOutput = isExec ? parseExecOutput(item.output) ?? parseExecOutput(item.output ? cleanExecOutput(item.output) : null) : null;
  const contentBlocks = parseToolContentBlocks(item.output);
  const nestedProjection = isExec ? parseNestedActivities(item.arguments, item.output) : null;
  const nestedActivities = nestedProjection?.activities ?? null;
  const fallbackOutput = isExec && !nestedProjection && !execArguments && !webSearchQueries
    ? execResultsFromContent(contentBlocks, item.output) : null;
  const unpairedOutputs = nestedProjection?.unpairedOutputs ?? fallbackOutput?.outputs.map(({ result }) => result) ?? [];
  const unparsedOutputText = nestedProjection?.unparsedOutputText ?? fallbackOutput?.unparsedOutputText ?? null;
  const argumentsText = execArguments?.command ?? (parsedArguments ? null : item.arguments);
  const displayToolName = execArguments?.kind === "patch"
    ? "apply_patch"
    : nestedWriteStdinArguments
      ? toolName
      : item.name;
  const rawOutputText = contentBlocks ? contentBlocks.text : execOutput?.stdout ?? (execOutput ? null : item.output);
  const outputText = unpairedOutputs.length > 0 ? unparsedOutputText
    : isExec && isEmptyExecOutput(rawOutputText) ? null : rawOutputText;
  const stderrText = execOutput?.stderr ?? item.stderr;

  return { outerToolName, backgroundTerminalInput, userInputQuestions, webSearchQueries, webSearchResults, nestedActivities, unpairedOutputs, unparsedOutputText, execArguments, argumentEntries, execOutput, contentBlocks, argumentsText, displayToolName, outputText, stderrText };
}

export type ToolActivity = ReturnType<typeof buildToolActivity>;

export type Exploration = { label: "Read" | "Search" | "List"; text: string };
export type ConversationBlock =
  | { kind: "item"; entry: TimelineEntry }
  | { kind: "exploration"; entries: TimelineEntry[]; actions: Exploration[][] };

// Deliberately classify only literal, known read-only commands. Unknown shell syntax
// stays a command with its output; never hide a write/test behind an Explored label.
export function classifyExploration(command: string): Exploration[] | null {
  if (/[`$\\\n]/.test(command)) return null;
  const tokens = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|[;&|<>]|[^\s;&|<>"']+/g) ?? [];
  if (tokens.join("").replace(/\s/g, "") !== command.replace(/\s/g, "")) return null;
  const commands: string[][] = [[]];
  for (const token of tokens) {
    if (token === ";" || token === "&&") commands.push([]);
    else if (["&", "|", "<", ">"].includes(token)) return null;
    else {
      if (!/^["']/.test(token) && /[()#]/.test(token)) return null;
      commands.at(-1)!.push(token.replace(/^("|')(.*)\1$/, "$2"));
    }
  }
  const actions: Exploration[] = [];
  for (const words of commands) {
    if (words[0] === "rtk") words.shift();
    if (words[0] === "proxy") words.shift();
    const name = words.shift();
    if (["sh", "bash", "zsh", "/bin/sh", "/bin/bash", "/bin/zsh"].includes(name ?? "") && words.length === 2 && ["-c", "-lc"].includes(words[0])) {
      const nested = classifyExploration(words[1]);
      if (!nested) return null;
      actions.push(...nested);
    } else if (name === "cat" && words.length && words.every((word) => !word.startsWith("-"))) {
      actions.push(...words.map((text) => ({ label: "Read" as const, text })));
    } else if (name === "sed" && words[0] === "-n" && /^\d+(,\d+)?p$/.test(words[1] ?? "") && words.length === 3) {
      actions.push({ label: "Read", text: words[2] });
    } else if (name === "ls" && words.every((word) => !word.startsWith("-") || /^-[alhAF1]+$/.test(word))) {
      actions.push({ label: "List", text: words.filter((word) => !word.startsWith("-")).join(", ") || "." });
    } else if (name === "rg" || name === "grep") {
      const args: string[] = [];
      let list = false;
      for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        if (word === "--files" && name === "rg") list = true;
        else if (["-g", "--glob", "-t", "--type"].includes(word)) { if (!words[++i]) return null; }
        else if (/^-[nilwSF]+$/.test(word) || word === "--hidden") continue;
        else if (word.startsWith("-")) return null;
        else args.push(word);
      }
      if (!list && !args.length) return null;
      actions.push({ label: list ? "List" : "Search", text: list ? command : args.join(" in ") });
    } else return null;
  }
  return actions.length ? actions : null;
}

function buildTurnConversation(turn: SessionReplayDetail["turns"][number], previousTotalTokens: { value?: number }): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  for (const entry of timelineEntries(orderedItems(turn), previousTotalTokens)) {
    if (!isVisibleTimelineItem(entry.item)) continue;
    const activity = entry.activity;
    const tool = entry.item.kind === "toolCall" ? entry.item : null;
    // Batch results retain their individual exit status/output; don't infer success
    // from the outer orchestration call or allocate its tokens to nested commands.
    const actions = tool && !tool.isError && tool.status !== "running" && tool.status !== "stopped"
      && activity?.execArguments?.kind === "command" && !activity.nestedActivities
      && !/tools\.(?!exec_command\b)\w+\s*\(/.test(tool.arguments ?? "")
      && processExitCode(tool.output, tool.isError) === 0
      ? classifyExploration(activity.execArguments.command) : null;
    if (actions) {
      const previous = blocks.at(-1);
      if (previous?.kind === "exploration") {
        previous.entries.push(entry);
        previous.actions.push(actions);
      } else blocks.push({ kind: "exploration", entries: [entry], actions: [actions] });
    } else blocks.push({ kind: "item", entry });
  }
  return blocks;
}

export function buildConversation(turn: SessionReplayDetail["turns"][number]): ConversationBlock[] {
  return buildTurnConversation(turn, {});
}

export function buildSessionConversation(turns: SessionReplayDetail["turns"]): ConversationBlock[][] {
  const previousTotalTokens: { value?: number } = {};
  return turns.map((turn) => buildTurnConversation(turn, previousTotalTokens));
}

export function summarizeOutput(text: string) {
  const lines = text.split("\n");
  const shorten = (line: string) => line.length > 240 ? `${line.slice(0, 240)}…` : line;
  return {
    head: (lines.length > 5 ? lines.slice(0, 3) : lines).map(shorten),
    tail: lines.length > 5 ? lines.slice(-2).map(shorten) : [],
    omitted: Math.max(0, lines.length - 5),
  };
}
