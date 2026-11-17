import { Token, TokenType } from "./ast.js";

// ─── Keyword table (all lowercase) ──────────────────────────────────────────

const KEYWORDS = new Map<string, TokenType>([
  ["sub", TokenType.Sub],
  ["function", TokenType.Function],
  ["end", TokenType.End],
  ["dim", TokenType.Dim],
  ["const", TokenType.Const],
  ["if", TokenType.If],
  ["elseif", TokenType.ElseIf],
  ["else", TokenType.Else],
  ["then", TokenType.Then],
  ["select", TokenType.Select],
  ["case", TokenType.Case],
  ["for", TokenType.For],
  ["each", TokenType.Each],
  ["next", TokenType.Next],
  ["to", TokenType.To],
  ["step", TokenType.Step],
  ["do", TokenType.Do],
  ["loop", TokenType.Loop],
  ["while", TokenType.While],
  ["wend", TokenType.Wend],
  ["exit", TokenType.Exit],
  ["with", TokenType.With],
  ["set", TokenType.Set],
  ["let", TokenType.Let],
  ["new", TokenType.New],
  ["nothing", TokenType.Nothing],
  ["true", TokenType.True],
  ["false", TokenType.False],
  ["and", TokenType.And],
  ["or", TokenType.Or],
  ["not", TokenType.Not],
  ["mod", TokenType.Mod],
  ["is", TokenType.Is],
  ["like", TokenType.Like],
  ["byval", TokenType.ByVal],
  ["byref", TokenType.ByRef],
  ["as", TokenType.As],
  ["option", TokenType.Option],
  ["base", TokenType.Base],
  ["explicit", TokenType.Explicit],
  ["compare", TokenType.Compare],
  ["text", TokenType.Text],
  ["binary", TokenType.Binary],
  ["redim", TokenType.ReDim],
  ["preserve", TokenType.Preserve],
  ["public", TokenType.Public],
  ["private", TokenType.Private],
  ["friend", TokenType.Friend],
  ["protected", TokenType.Protected],
  ["static", TokenType.Static],
  ["on", TokenType.On],
  ["error", TokenType.Error],
  ["resume", TokenType.Resume],
  ["goto", TokenType.GoTo],
  ["return", TokenType.Return],
  ["declare", TokenType.Declare],
  ["ptrsafe", TokenType.PtrSafe],
  ["lib", TokenType.Lib],
  ["alias", TokenType.Alias],
  ["in", TokenType.In],
  ["open", TokenType.Open],
  ["close", TokenType.Close],
  ["print", TokenType.Print],
  ["input", TokenType.Input],
  ["write", TokenType.Write],
  ["get", TokenType.Get],
  ["put", TokenType.Put],
  ["output", TokenType.Output],
  ["append", TokenType.Append],
  ["random", TokenType.Random],
  // Type names
  ["integer", TokenType.TInteger],
  ["long", TokenType.TLong],
  ["double", TokenType.TDouble],
  ["string", TokenType.TString],
  ["boolean", TokenType.TBoolean],
  ["date", TokenType.TDate],
  ["variant", TokenType.TVariant],
  ["object", TokenType.TObject],
  ["currency", TokenType.TCurrency],
  ["single", TokenType.TSingle],
  ["byte", TokenType.TByte],
  ["longlong", TokenType.TLongLong],
  ["longptr", TokenType.TLongPtr],
]);

// Type-declaration suffixes that attach to an identifier with no space
const TYPE_DECL_CHARS = new Set(["%", "&", "!", "#", "@", "$"]);

// ─── Lexer ───────────────────────────────────────────────────────────────────

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek(offset = 0): string {
    return pos + offset < source.length ? source[pos + offset] : "";
  }

  function advance(): string {
    const ch = source[pos++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function emit(type: TokenType, value: string, tokenLine: number, tokenCol: number): void {
    tokens.push({ type, value, line: tokenLine, col: tokenCol });
  }



  function readString(startLine: number, startCol: number): void {
    let value = '"';
    advance(); // consume opening "
    while (pos < source.length) {
      const ch = peek();
      if (ch === '"') {
        advance(); // consume "
        if (peek() === '"') {
          // escaped quote
          advance();
          value += '"';
        } else {
          break;
        }
      } else if (ch === "\n" || ch === "\r") {
        // unterminated string — stop
        break;
      } else {
        value += advance();
      }
    }
    value += '"';
    emit(TokenType.StringLiteral, value, startLine, startCol);
  }

  function readDateLiteral(startLine: number, startCol: number): void {
    let value = "#";
    advance(); // consume opening #
    while (pos < source.length) {
      const ch = peek();
      if (ch === "#") {
        advance();
        break;
      } else if (ch === "\n" || ch === "\r") {
        break;
      } else {
        value += advance();
      }
    }
    value += "#";
    emit(TokenType.DateLiteral, value, startLine, startCol);
  }

  function readNumber(startLine: number, startCol: number): void {
    let value = "";
    let isFloat = false;
    // Integer part
    while (pos < source.length && isDigit(peek())) {
      value += advance();
    }
    // Decimal
    if (peek() === "." && isDigit(peek(1))) {
      isFloat = true;
      value += advance(); // .
      while (pos < source.length && isDigit(peek())) {
        value += advance();
      }
    }
    // Exponent
    if (peek().toLowerCase() === "e") {
      const next = peek(1);
      if (next === "+" || next === "-" || isDigit(next)) {
        isFloat = true;
        value += advance(); // e
        if (peek() === "+" || peek() === "-") value += advance();
        while (pos < source.length && isDigit(peek())) value += advance();
      }
    }
    // Type suffix
    const suffix = peek();
    let type: TokenType;
    if (suffix === "%" || suffix === "&" || suffix === "^") {
      value += advance();
      type = isFloat ? TokenType.DoubleLiteral : TokenType.LongLiteral;
    } else if (suffix === "!" || suffix === "#" || suffix === "@") {
      value += advance();
      type = TokenType.DoubleLiteral;
    } else {
      type = isFloat ? TokenType.DoubleLiteral : TokenType.IntegerLiteral;
    }
    emit(type, value, startLine, startCol);
  }

  function readHexOrOctal(startLine: number, startCol: number): void {
    let value = "&";
    advance(); // consume &
    const prefix = peek().toLowerCase();
    if (prefix === "h" || prefix === "o") {
      value += advance();
      while (pos < source.length && isHexDigit(peek())) {
        value += advance();
      }
      // optional type suffix
      if (peek() === "&" || peek() === "%") {
        value += advance();
      }
      emit(TokenType.LongLiteral, value, startLine, startCol);
    } else {
      // It's the & concat operator
      emit(TokenType.Concat, "&", startLine, startCol);
    }
  }

  function readIdentifierOrKeyword(startLine: number, startCol: number): void {
    let value = "";
    while (pos < source.length && isIdentChar(peek())) {
      value += advance();
    }
    // Type-declaration suffix (must be immediately adjacent, no space)
    if (TYPE_DECL_CHARS.has(peek())) {
      value += advance();
    }

    const lower = value.toLowerCase();

    // Rem is a comment introducer
    if (lower === "rem") {
      let commentText = value;
      while (pos < source.length && peek() !== "\n" && peek() !== "\r") {
        commentText += advance();
      }
      emit(TokenType.Comment, commentText, startLine, startCol);
      return;
    }

    const kw = KEYWORDS.get(lower.replace(/[%&!#@$]$/, ""));
    if (kw !== undefined && !TYPE_DECL_CHARS.has(value[value.length - 1])) {
      emit(kw, value, startLine, startCol);
    } else {
      emit(TokenType.Identifier, value, startLine, startCol);
    }
  }

  while (pos < source.length) {
    const startLine = line;
    const startCol = col;
    const ch = peek();

    // Skip CR
    if (ch === "\r") {
      advance();
      continue;
    }

    // Newline
    if (ch === "\n") {
      emit(TokenType.Newline, "\n", startLine, startCol);
      advance();
      continue;
    }

    // Whitespace (not newline)
    if (ch === " " || ch === "\t") {
      advance();
      continue;
    }

    // Line continuation: _ followed by optional whitespace then \n
    if (ch === "_") {
      // Look ahead to see if rest of line is whitespace then \n
      let look = pos + 1;
      while (look < source.length && (source[look] === " " || source[look] === "\t")) look++;
      if (look < source.length && (source[look] === "\n" || source[look] === "\r")) {
        // consume _ and whitespace and newline
        advance(); // _
        while (peek() === " " || peek() === "\t") advance();
        if (peek() === "\r") advance();
        if (peek() === "\n") advance();
        // Do NOT emit Newline — line continuation
        continue;
      }
      // Otherwise it's just an identifier character (shouldn't normally happen in VBA)
      readIdentifierOrKeyword(startLine, startCol);
      continue;
    }

    // Comment
    if (ch === "'") {
      let commentText = "";
      advance(); // consume '
      while (pos < source.length && peek() !== "\n" && peek() !== "\r") {
        commentText += advance();
      }
      emit(TokenType.Comment, "'" + commentText, startLine, startCol);
      continue;
    }

    // String literal
    if (ch === '"') {
      readString(startLine, startCol);
      continue;
    }

    // Date literal
    if (ch === "#") {
      // Could be date literal #...# or the Hash token (for file numbers like #1)
      // Look ahead to disambiguate: if next char after # is a digit or space, it might be date
      // but #1 is a file number. We'll check: if it matches a date-ish pattern
      // Actually check if there's a closing # on the same line
      let look = pos + 1;
      let foundClose = false;
      while (look < source.length && source[look] !== "\n" && source[look] !== "\r") {
        if (source[look] === "#") { foundClose = true; break; }
        look++;
      }
      if (foundClose && look > pos + 1) {
        readDateLiteral(startLine, startCol);
      } else {
        advance();
        emit(TokenType.Hash, "#", startLine, startCol);
      }
      continue;
    }

    // Numbers (digits)
    if (isDigit(ch)) {
      readNumber(startLine, startCol);
      continue;
    }

    // & prefix — hex/octal literal or concat
    if (ch === "&") {
      const next = peek(1).toLowerCase();
      if (next === "h" || next === "o") {
        readHexOrOctal(startLine, startCol);
      } else {
        advance();
        emit(TokenType.Concat, "&", startLine, startCol);
      }
      continue;
    }

    // Identifiers and keywords
    if (isIdentStart(ch)) {
      readIdentifierOrKeyword(startLine, startCol);
      continue;
    }

    // Operators and punctuation
    switch (ch) {
      case "=":
        advance();
        emit(TokenType.Assign, "=", startLine, startCol);
        break;
      case "<":
        advance();
        if (peek() === "=") { advance(); emit(TokenType.Lte, "<=", startLine, startCol); }
        else if (peek() === ">") { advance(); emit(TokenType.Neq, "<>", startLine, startCol); }
        else emit(TokenType.Lt, "<", startLine, startCol);
        break;
      case ">":
        advance();
        if (peek() === "=") { advance(); emit(TokenType.Gte, ">=", startLine, startCol); }
        else emit(TokenType.Gt, ">", startLine, startCol);
        break;
      case "+":
        advance();
        emit(TokenType.Plus, "+", startLine, startCol);
        break;
      case "-":
        advance();
        emit(TokenType.Minus, "-", startLine, startCol);
        break;
      case "*":
        advance();
        emit(TokenType.Star, "*", startLine, startCol);
        break;
      case "/":
        advance();
        emit(TokenType.Slash, "/", startLine, startCol);
        break;
      case "\\":
        advance();
        emit(TokenType.Backslash, "\\", startLine, startCol);
        break;
      case "^":
        advance();
        emit(TokenType.Caret, "^", startLine, startCol);
        break;
      case ".":
        advance();
        emit(TokenType.Dot, ".", startLine, startCol);
        break;
      case "!":
        advance();
        emit(TokenType.Bang, "!", startLine, startCol);
        break;
      case "(":
        advance();
        emit(TokenType.LParen, "(", startLine, startCol);
        break;
      case ")":
        advance();
        emit(TokenType.RParen, ")", startLine, startCol);
        break;
      case ",":
        advance();
        emit(TokenType.Comma, ",", startLine, startCol);
        break;
      case ":":
        advance();
        if (peek() === "=") { advance(); emit(TokenType.NamedAssign, ":=", startLine, startCol); }
        else emit(TokenType.Colon, ":", startLine, startCol);
        break;
      default:
        advance();
        emit(TokenType.Unknown, ch, startLine, startCol);
        break;
    }
  }

  emit(TokenType.EOF, "", line, col);
  return tokens;
}

// ─── Character helpers ───────────────────────────────────────────────────────

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function isIdentStart(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    ch === "_" ||
    // Allow Unicode letters (for Cyrillic identifiers etc.)
    ch.charCodeAt(0) > 127
  );
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}
