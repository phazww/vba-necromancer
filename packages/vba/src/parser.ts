import {
  Token,
  TokenType,
  ModuleAST,
  ModuleOptions,
  Declaration,
  ProcedureDecl,
  SubDecl,
  FunctionDecl,
  Parameter,
  Statement,
  DimStatement,
  DimDeclarator,
  ConstStatement,
  AssignStatement,
  SetStatement,
  CallStatement,
  IfStatement,
  ElseIfClause,
  SelectStatement,
  CaseClause,
  CaseTest,
  ForStatement,
  ForEachStatement,
  DoStatement,
  WhileStatement,
  WithStatement,
  ExitStatement,
  ReDimStatement,
  OnErrorStatement,
  UnsupportedStatement,
  LabelStatement,
  GoToStatement,
  ReturnStatement,
  Expression,
  Literal,
  IdentifierExpr,
  BinaryExpr,
  UnaryExpr,
  MemberExpr,
  IndexExpr,
  CallExpr,
  NothingExpr,
  WithMemberExpr,
  NewExpr,
  NodeLocation,
} from "./ast.js";
import { ParseError, UnsupportedError } from "./errors.js";

export function parse(tokens: Token[], moduleName: string): ModuleAST {
  return new Parser(tokens, moduleName).parseModule();
}

// ─── Parser class ────────────────────────────────────────────────────────────

class Parser {
  private pos = 0;
  private readonly moduleName: string;
  private readonly tokens: Token[];

  constructor(tokens: Token[], moduleName: string) {
    this.tokens = tokens;
    this.moduleName = moduleName;
  }

  // ── Token navigation ──────────────────────────────────────────────────────

  private peek(offset = 0): Token {
    const i = this.pos + offset;
    return i < this.tokens.length ? this.tokens[i] : this.tokens[this.tokens.length - 1];
  }

  private current(): Token {
    return this.peek(0);
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private checkValue(value: string): boolean {
    return this.current().value.toLowerCase() === value.toLowerCase();
  }

  private match(...types: TokenType[]): boolean {
    for (const t of types) {
      if (this.check(t)) { this.advance(); return true; }
    }
    return false;
  }

  private consume(type: TokenType, message?: string): Token {
    if (this.check(type)) return this.advance();
    const cur = this.current();
    throw new ParseError(
      message ?? `Expected ${TokenType[type]}, got '${cur.value}'`,
      this.moduleName,
      cur.line,
      cur.col,
    );
  }

  private loc(): NodeLocation {
    return { module: this.moduleName, line: this.current().line };
  }

  private locAt(tok: Token): NodeLocation {
    return { module: this.moduleName, line: tok.line };
  }

  /** Skip newlines, comments */
  private skipNewlines(): void {
    while (this.check(TokenType.Newline) || this.check(TokenType.Comment)) {
      this.advance();
    }
  }

  /** Consume to end of logical line (up to and including Newline or EOF) */
  private skipToNextLine(): void {
    while (
      !this.check(TokenType.EOF) &&
      !this.check(TokenType.Newline)
    ) {
      // stop at Colon too — it's a statement separator, not consumed here
      if (this.check(TokenType.Colon)) break;
      this.advance();
    }
    if (this.check(TokenType.Newline)) this.advance();
  }

  /** Skip remaining tokens on the current line, returning their text */
  private collectLineRaw(): string {
    const parts: string[] = [];
    while (
      !this.check(TokenType.EOF) &&
      !this.check(TokenType.Newline) &&
      !this.check(TokenType.Colon)
    ) {
      parts.push(this.advance().value);
    }
    return parts.join(" ");
  }

  // ── Module-level parse ────────────────────────────────────────────────────

  parseModule(): ModuleAST {
    const options: ModuleOptions = { explicit: false, base: 0, compareMode: "binary" };
    const declarations: Declaration[] = [];
    const procedures: ProcedureDecl[] = [];

    this.skipNewlines();

    while (!this.check(TokenType.EOF)) {
      const tok = this.current();

      // Skip pure comments / blank lines
      if (tok.type === TokenType.Newline || tok.type === TokenType.Comment) {
        this.advance();
        continue;
      }

      // Option statements
      if (tok.type === TokenType.Option) {
        this.parseOption(options);
        continue;
      }

      // Procedure declarations
      if (this.isProcedureStart()) {
        procedures.push(this.parseProcedure());
        continue;
      }

      // Module-level Dim / Const (possibly with Public/Private prefix)
      const scope = this.parseScopeModifier();
      if (this.check(TokenType.Dim) || (scope !== "" && this.check(TokenType.Dim))) {
        declarations.push(this.parseDim("Module", scope !== "Public" ? "Module" : "Public"));
        continue;
      }
      if (this.check(TokenType.Const)) {
        declarations.push(this.parseConst("Module", scope !== "Public" ? "Module" : "Public"));
        continue;
      }

      // If we advanced past a scope modifier but didn't match Dim/Const,
      // fall through to unsupported.
      // Module-level Declare / attribute / other unsupported
      declarations.push(this.parseUnsupportedLine());
    }

    return {
      kind: "Module",
      module: this.moduleName,
      options,
      declarations,
      procedures,
    };
  }

  private parseOption(options: ModuleOptions): void {
    this.advance(); // consume "Option"
    const kw = this.current();
    if (kw.type === TokenType.Explicit) {
      options.explicit = true;
      this.advance();
    } else if (kw.type === TokenType.Base) {
      this.advance();
      const val = this.current();
      if (val.value === "1") options.base = 1;
      this.advance();
    } else if (kw.type === TokenType.Compare) {
      this.advance();
      const mode = this.current();
      if (mode.type === TokenType.Text) options.compareMode = "text";
      else options.compareMode = "binary";
      this.advance();
    } else {
      // unknown Option … skip
    }
    this.skipToNextLine();
  }

  private isProcedureStart(): boolean {
    const tok = this.current();
    // Public/Private/Friend/Static Sub/Function
    if (
      tok.type === TokenType.Public ||
      tok.type === TokenType.Private ||
      tok.type === TokenType.Friend ||
      tok.type === TokenType.Static
    ) {
      const next = this.peek(1);
      return next.type === TokenType.Sub || next.type === TokenType.Function;
    }
    return tok.type === TokenType.Sub || tok.type === TokenType.Function;
  }

  private parseScopeModifier(): "Public" | "Private" | "Friend" | "Static" | "" {
    const tok = this.current();
    if (tok.type === TokenType.Public) { this.advance(); return "Public"; }
    if (tok.type === TokenType.Private) { this.advance(); return "Private"; }
    if (tok.type === TokenType.Friend) { this.advance(); return "Friend"; }
    if (tok.type === TokenType.Static) { this.advance(); return "Static"; }
    return "";
  }

  private parseProcedure(): ProcedureDecl {
    const loc = this.loc();
    const scope = this.parseScopeModifier();
    const isFunction = this.check(TokenType.Function);
    this.advance(); // consume Sub / Function

    const nameTok = this.consume(TokenType.Identifier, "Expected procedure name");
    const name = nameTok.value;

    const params = this.parseParamList();

    let returnType: string | null = null;
    if (isFunction && this.check(TokenType.As)) {
      this.advance();
      returnType = this.parseTypeName();
    }

    this.skipToNextLine();

    const { stmts: body, endLine } = this.parseBody(isFunction ? "Function" : "Sub");

    if (isFunction) {
      const decl: FunctionDecl = {
        ...loc,
        kind: "FunctionDecl",
        name,
        scope,
        params,
        returnType,
        body,
        endLine,
      };
      return decl;
    } else {
      const decl: SubDecl = {
        ...loc,
        kind: "SubDecl",
        name,
        scope,
        params,
        body,
        endLine,
      };
      return decl;
    }
  }

  private parseParamList(): Parameter[] {
    const params: Parameter[] = [];
    if (!this.check(TokenType.LParen)) return params;
    this.advance(); // (
    if (this.check(TokenType.RParen)) { this.advance(); return params; }

    while (!this.check(TokenType.RParen) && !this.check(TokenType.EOF)) {
      params.push(this.parseParam());
      if (this.check(TokenType.Comma)) this.advance();
    }

    if (this.check(TokenType.RParen)) this.advance();
    return params;
  }

  private parseParam(): Parameter {
    let passing: "ByVal" | "ByRef" = "ByRef";
    let optional = false;

    // Optional keyword
    if (this.check(TokenType.Identifier) && this.checkValue("optional")) {
      optional = true;
      this.advance();
    }

    if (this.check(TokenType.ByVal)) { passing = "ByVal"; this.advance(); }
    else if (this.check(TokenType.ByRef)) { passing = "ByRef"; this.advance(); }

    // ParamArray
    if (this.check(TokenType.Identifier) && this.checkValue("paramarray")) {
      this.advance();
    }

    const nameTok = this.current();
    const name = nameTok.value;
    this.advance();

    // Check if it's an array parameter: name()
    let isArray = false;
    if (this.check(TokenType.LParen)) {
      isArray = true;
      this.advance();
      if (this.check(TokenType.RParen)) this.advance();
    }

    let typeName: string | null = null;
    if (this.check(TokenType.As)) {
      this.advance();
      typeName = this.parseTypeName();
    }

    let defaultValue: Expression | null = null;
    if (this.check(TokenType.Assign)) {
      this.advance();
      defaultValue = this.parseExpression();
    }

    return { name, typeName, passing, optional, defaultValue, isArray };
  }

  /** Reads `Ident ( . Ident )*` and returns the joined name, e.g. "Scripting.Dictionary". */
  private parseDottedName(): string {
    let name = this.advance().value;
    while (this.check(TokenType.Dot) && /^[A-Za-z_]/.test(this.peek(1).value)) {
      this.advance();
      name += "." + this.advance().value;
    }
    return name;
  }

  private parseTypeName(): string {
    // Allow "New TypeName" in type position (parameters): skip New
    if (this.check(TokenType.New)) this.advance();
    return this.parseDottedName();
  }

  // ── Body (statement list) ─────────────────────────────────────────────────

  private parseBody(endKind: "Sub" | "Function"): { stmts: Statement[]; endLine: number } {
    const stmts: Statement[] = [];
    this.skipNewlines();

    while (!this.check(TokenType.EOF)) {
      const tok = this.current();

      // End Sub / End Function
      if (tok.type === TokenType.End) {
        const next = this.peek(1);
        if (
          (endKind === "Sub" && next.type === TokenType.Sub) ||
          (endKind === "Function" && next.type === TokenType.Function)
        ) {
          const endLine = this.advance().line; // End
          this.advance(); // Sub/Function
          this.skipToNextLine();
          return { stmts, endLine };
        }
      }

      if (tok.type === TokenType.Newline || tok.type === TokenType.Comment) {
        this.advance();
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }

    // No matching End Sub/Function found — return what we have
    return { stmts, endLine: this.lastLine() };
  }

  /** Line of the last token before EOF (the EOF token itself when the source is empty). */
  private lastLine(): number {
    const last = this.tokens[this.tokens.length - 1];
    let i = this.tokens.length - 1;
    while (i > 0 && (this.tokens[i].type === TokenType.EOF || this.tokens[i].type === TokenType.Newline)) i--;
    return this.tokens[i]?.line ?? last.line;
  }

  // ── Statement dispatch ────────────────────────────────────────────────────

  private parseStatement(): Statement | null {
    const tok = this.current();

    // Skip naked colons (statement separators without statement before them)
    if (tok.type === TokenType.Colon) {
      this.advance();
      return null;
    }

    if (tok.type === TokenType.Dim) return this.parseDim("Local", "Local");
    if (tok.type === TokenType.ReDim) return this.parseReDim();
    if (tok.type === TokenType.Const) return this.parseConst("Local", "Local");
    if (tok.type === TokenType.Set) return this.parseSet();
    if (tok.type === TokenType.If) return this.parseIf();
    if (tok.type === TokenType.Select) return this.parseSelect();
    if (tok.type === TokenType.For) return this.parseFor();
    if (tok.type === TokenType.Do) return this.parseDo();
    if (tok.type === TokenType.While) return this.parseWhile();
    if (tok.type === TokenType.With) return this.parseWith();
    if (tok.type === TokenType.Exit) return this.parseExit();
    if (tok.type === TokenType.Return) {
      const loc = this.loc();
      this.advance();
      this.endStatement();
      const ret: ReturnStatement = { ...loc, kind: "ReturnStatement" };
      return ret;
    }
    if (tok.type === TokenType.On) return this.parseOnError();
    if (tok.type === TokenType.GoTo) return this.parseGoTo();
    if (tok.type === TokenType.Resume) return this.parseUnsupportedLine();
    if (this.isLabelAhead()) return this.parseLabel();

    // Public/Private/Static — module-level only, shouldn't appear in body but guard
    if (
      tok.type === TokenType.Public ||
      tok.type === TokenType.Private ||
      tok.type === TokenType.Static
    ) {
      return this.parseUnsupportedLine();
    }

    // Declare (also handled as UnsupportedStatement)
    if (tok.type === TokenType.Declare) return this.parseUnsupportedLine();

    // Open / Close / Print / Input (file I/O) → UnsupportedStatement
    if (
      tok.type === TokenType.Open ||
      tok.type === TokenType.Close ||
      tok.type === TokenType.Print ||
      tok.type === TokenType.Input ||
      tok.type === TokenType.Write ||
      tok.type === TokenType.Put ||
      tok.type === TokenType.Get
    ) {
      return this.parseUnsupportedLine();
    }

    // Line Input #n, var (file I/O)
    if (
      tok.type === TokenType.Identifier &&
      tok.value.toLowerCase() === "line" &&
      this.peek(1).type === TokenType.Input
    ) {
      const loc = this.loc();
      this.advance();
      this.advance();
      const construct = this.current().type === TokenType.Hash ? "Line Input #" : "Line Input";
      const raw = "Line Input " + this.collectLineRaw();
      this.endStatement();
      return { ...loc, kind: "UnsupportedStatement", construct, raw };
    }

    // Let (optional assignment keyword)
    if (tok.type === TokenType.Let) {
      this.advance();
      return this.parseAssignOrCall();
    }

    // Identifier or expression start (assignment or call)
    return this.parseAssignOrCall();
  }

  private parseAssignOrCall(): Statement {
    const loc = this.loc();
    // Parse just the postfix chain (identifier, member accesses, index/call with parens)
    // but NOT comparison operators. This gives us the LHS candidate.
    const lhs = this.parsePostfix();

    // Check for assignment: lhs = rhs
    if (this.check(TokenType.Assign)) {
      this.advance();
      const value = this.parseExpression();
      this.endStatement();
      const stmt: AssignStatement = { ...loc, kind: "AssignStatement", target: lhs, value };
      return stmt;
    }

    // Not assignment — LHS might be the start of a larger expression (e.g. negation, comparison
    // is unlikely at statement start, but handle). We now need to finish parsing from lhs
    // as if it were the first token of a full expression. We'll "wrap" lhs back into the
    // operator-precedence chain by promoting it.
    const expr = this.startsSignedArgument(lhs) ? lhs : this.continueExpression(lhs);

    // Otherwise treat as a call statement
    let args: Expression[] = [];
    if (
      !this.check(TokenType.Newline) &&
      !this.check(TokenType.EOF) &&
      !this.check(TokenType.Colon) &&
      !this.check(TokenType.Comment)
    ) {
      // Could be bare-argument call: Foo a, b
      if (expr.kind === "Identifier" || expr.kind === "MemberExpr" || expr.kind === "CallExpr") {
        args = this.parseArgListNoParens();
      }
    }

    this.endStatement();

    // If the expression is already a CallExpr (had parens), expose it
    if (expr.kind === "CallExpr" && args.length === 0) {
      const stmt: CallStatement = { ...loc, kind: "CallStatement", callee: expr.callee, args: expr.args };
      return stmt;
    }

    const stmt: CallStatement = { ...loc, kind: "CallStatement", callee: expr, args };
    return stmt;
  }

  /**
   * `Foo -1, 2` / `obj.Method -1`: a name or member without parentheses, then a `+`/`-` that
   * has whitespace before it and none after it, starts the first argument (CALL-01).
   */
  private startsSignedArgument(lhs: Expression): boolean {
    if (lhs.kind !== "Identifier" && lhs.kind !== "MemberExpr") return false;
    const sign = this.current();
    if (sign.type !== TokenType.Plus && sign.type !== TokenType.Minus) return false;
    const prev = this.tokens[this.pos - 1];
    const next = this.peek(1);
    if (!prev || prev.line !== sign.line || next.line !== sign.line) return false;
    return prev.col + prev.value.length < sign.col && next.col === sign.col + 1;
  }

  /**
   * Continue building an expression from an already-parsed primary/postfix node.
   * This covers cases where the LHS of a statement is a larger expression (unusual
   * in VBA but possible, e.g. negation at statement level is odd but we handle it).
   */
  private continueExpression(left: Expression): Expression {
    // Handle concat, arithmetic, comparison operators that might follow
    return this.continueOr(left);
  }

  private continueOr(left: Expression): Expression {
    left = this.continueAnd(left);
    while (this.check(TokenType.Or)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseAnd();
      left = { ...loc, kind: "BinaryExpr", op, left, right } as BinaryExpr;
    }
    return left;
  }

  private continueAnd(left: Expression): Expression {
    left = this.continueConcat(left);
    while (this.check(TokenType.And)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseNot();
      left = { ...loc, kind: "BinaryExpr", op, left, right } as BinaryExpr;
    }
    return left;
  }

  private continueConcat(left: Expression): Expression {
    left = this.continueAddSub(left);
    while (this.check(TokenType.Concat)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseAddSub();
      left = { ...loc, kind: "BinaryExpr", op, left, right } as BinaryExpr;
    }
    return left;
  }

  private continueAddSub(left: Expression): Expression {
    left = this.continueMulDiv(left);
    while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseMulDiv();
      left = { ...loc, kind: "BinaryExpr", op, left, right } as BinaryExpr;
    }
    return left;
  }

  private continueMulDiv(left: Expression): Expression {
    left = this.continuePower(left);
    while (
      this.check(TokenType.Star) ||
      this.check(TokenType.Slash) ||
      this.check(TokenType.Backslash) ||
      this.check(TokenType.Mod)
    ) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { ...loc, kind: "BinaryExpr", op, left, right } as BinaryExpr;
    }
    return left;
  }

  private continuePower(left: Expression): Expression {
    // VBA's ^ is left-associative: 2^3^2 = (2^3)^2 = 64
    while (this.check(TokenType.Caret)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parsePowerOperand();
      left = { ...loc, kind: "BinaryExpr", op, left, right } as BinaryExpr;
    }
    return left;
  }

  /** Right operand of ^: an optional sign, then a postfix expression (no further ^). */
  private parsePowerOperand(): Expression {
    if (this.check(TokenType.Minus)) {
      const loc = this.loc();
      const op = this.advance().value;
      const operand = this.parsePowerOperand();
      return { ...loc, kind: "UnaryExpr", op, operand } as UnaryExpr;
    }
    if (this.check(TokenType.Plus)) {
      this.advance();
      return this.parsePowerOperand();
    }
    return this.parsePostfix();
  }

  /** Parse comma-separated expressions without enclosing parens (for bare-call arguments) */
  private parseArgListNoParens(): Expression[] {
    const args: Expression[] = [];
    // Check if next token looks like it could be an argument
    if (
      this.check(TokenType.Newline) ||
      this.check(TokenType.EOF) ||
      this.check(TokenType.Colon) ||
      this.check(TokenType.Comment)
    ) {
      return args;
    }
    // Omitted arguments (Foo a, , c) become NothingExpr placeholders, as in parseArgList.
    for (;;) {
      args.push(this.check(TokenType.Comma) ? this.makeNothingExpr() : this.parseExpression());
      if (!this.check(TokenType.Comma)) break;
      this.advance();
      if (this.atStatementEnd()) {
        args.push(this.makeNothingExpr());
        break;
      }
    }
    return args;
  }

  private atStatementEnd(): boolean {
    return (
      this.check(TokenType.Newline) ||
      this.check(TokenType.EOF) ||
      this.check(TokenType.Colon) ||
      this.check(TokenType.Comment)
    );
  }

  private endStatement(): void {
    // A statement ends at: Newline, Colon (statement separator), Comment, or EOF
    if (this.check(TokenType.Newline)) { this.advance(); return; }
    if (this.check(TokenType.EOF)) return;
    if (this.check(TokenType.Comment)) { this.advance(); return; }
    if (this.check(TokenType.Colon)) return; // don't consume — the caller may need it
  }

  // ── Dim / Const ───────────────────────────────────────────────────────────

  private parseDim(
    _context: "Local" | "Module",
    scope: "Local" | "Module" | "Public",
  ): DimStatement {
    const loc = this.loc();
    this.advance(); // consume Dim
    const declarators: DimDeclarator[] = [];
    declarators.push(this.parseDimDeclarator());
    while (this.check(TokenType.Comma)) {
      this.advance();
      declarators.push(this.parseDimDeclarator());
    }
    this.endStatement();
    return { ...loc, kind: "DimStatement", scope, declarators };
  }

  private parseDimDeclarator(): DimDeclarator {
    const name = this.current().value;
    this.advance();
    let dimensions: Array<[Expression | null, Expression]> | null = null;
    if (this.check(TokenType.LParen)) {
      this.advance(); // (
      dimensions = [];
      if (!this.check(TokenType.RParen)) {
        dimensions.push(this.parseDimDimension());
        while (this.check(TokenType.Comma)) {
          this.advance();
          dimensions.push(this.parseDimDimension());
        }
      }
      this.consume(TokenType.RParen, "Expected ')' after array dimensions");
    }
    let typeName: string | null = null;
    let isNew = false;
    if (this.check(TokenType.As)) {
      this.advance();
      if (this.check(TokenType.New)) {
        this.advance();
        isNew = true;
      }
      typeName = this.parseTypeName();
    }
    return { name, typeName, dimensions, isNew };
  }

  private parseDimDimension(): [Expression | null, Expression] {
    const first = this.parseExpression();
    if (this.check(TokenType.To)) {
      this.advance();
      const second = this.parseExpression();
      return [first, second];
    }
    return [null, first];
  }

  private parseConst(
    _context: "Local" | "Module",
    scope: "Local" | "Module" | "Public",
  ): ConstStatement {
    const loc = this.loc();
    this.advance(); // consume Const
    const declarators = [];
    declarators.push(this.parseConstDeclarator());
    while (this.check(TokenType.Comma)) {
      this.advance();
      declarators.push(this.parseConstDeclarator());
    }
    this.endStatement();
    return { ...loc, kind: "ConstStatement", scope, declarators };
  }

  private parseConstDeclarator() {
    const name = this.current().value;
    this.advance();
    let typeName: string | null = null;
    if (this.check(TokenType.As)) {
      this.advance();
      typeName = this.parseTypeName();
    }
    this.consume(TokenType.Assign);
    const value = this.parseExpression();
    return { name, typeName, value };
  }

  // ── ReDim ─────────────────────────────────────────────────────────────────

  private parseReDim(): ReDimStatement {
    const loc = this.loc();
    this.advance(); // ReDim
    const preserve = this.check(TokenType.Preserve);
    if (preserve) this.advance();
    const name = this.current().value;
    this.advance();
    this.consume(TokenType.LParen);
    const dimensions: Array<[Expression | null, Expression]> = [];
    dimensions.push(this.parseDimDimension());
    while (this.check(TokenType.Comma)) {
      this.advance();
      dimensions.push(this.parseDimDimension());
    }
    this.consume(TokenType.RParen);
    if (this.check(TokenType.As)) {
      this.advance();
      this.parseTypeName(); // discard
    }
    this.endStatement();
    return { ...loc, kind: "ReDimStatement", preserve, variable: name, dimensions };
  }

  // ── Set ───────────────────────────────────────────────────────────────────

  private parseSet(): SetStatement {
    const loc = this.loc();
    this.advance(); // Set
    // Parse target as a postfix chain (don't consume = as comparison)
    const target = this.parsePostfix();
    this.consume(TokenType.Assign);
    const value = this.parseExpression();
    this.endStatement();
    return { ...loc, kind: "SetStatement", target, value };
  }

  // ── If / ElseIf / Else / End If ──────────────────────────────────────────

  /**
   * True when a single-line If body has ended: at a line break, a comment, EOF,
   * or right after a statement that already consumed its own line break.
   */
  private atSingleLineIfEnd(): boolean {
    if (
      this.check(TokenType.Newline) ||
      this.check(TokenType.EOF) ||
      this.check(TokenType.Comment)
    ) {
      return true;
    }
    return this.pos > 0 && this.tokens[this.pos - 1].type === TokenType.Newline;
  }

  private parseIf(): IfStatement {
    const loc = this.loc();
    this.advance(); // If
    const condition = this.parseExpression();
    this.consume(TokenType.Then, "Expected 'Then'");

    // Single-line If: If cond Then stmt
    if (!this.check(TokenType.Newline) && !this.check(TokenType.EOF) && !this.check(TokenType.Comment)) {
      // Everything up to end-of-line or Else is the then-body
      const thenStmts: Statement[] = [];
      while (
        !this.atSingleLineIfEnd() &&
        !(this.check(TokenType.Else))
      ) {
        const stmt = this.parseStatement();
        if (stmt) thenStmts.push(stmt);
        if (this.check(TokenType.Colon)) this.advance();
      }
      let elseBody: Statement[] | null = null;
      if (this.check(TokenType.Else)) {
        this.advance();
        elseBody = [];
        while (!this.atSingleLineIfEnd()) {
          const stmt = this.parseStatement();
          if (stmt) elseBody.push(stmt);
          if (this.check(TokenType.Colon)) this.advance();
        }
      }
      this.endStatement();
      return {
        ...loc,
        kind: "IfStatement",
        condition,
        thenBody: thenStmts,
        elseIfs: [],
        elseBody,
        singleLine: true,
      };
    }

    // Multi-line If
    this.endStatement();
    const thenBody = this.parseIfBody();
    const elseIfs: ElseIfClause[] = [];
    let elseBody: Statement[] | null = null;

    while (!this.check(TokenType.EOF)) {
      const cur = this.current();

      if (cur.type === TokenType.ElseIf) {
        const eiLoc = this.loc();
        this.advance();
        const eiCond = this.parseExpression();
        this.consume(TokenType.Then, "Expected 'Then'");
        this.endStatement();
        const eiBody = this.parseIfBody();
        elseIfs.push({ ...eiLoc, condition: eiCond, body: eiBody });
        continue;
      }

      if (cur.type === TokenType.Else) {
        this.advance();
        this.endStatement();
        elseBody = this.parseIfBody();
        continue; // the closing "End If" is consumed below
      }

      if (cur.type === TokenType.End) {
        const next = this.peek(1);
        if (next.type === TokenType.If) {
          this.advance(); // End
          this.advance(); // If
          this.endStatement();
          break;
        }
      }

      break;
    }

    return { ...loc, kind: "IfStatement", condition, thenBody, elseIfs, elseBody, singleLine: false };
  }

  private parseIfBody(): Statement[] {
    const stmts: Statement[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.EOF)) {
      const cur = this.current();

      // Look-ahead for ElseIf / Else / End If
      if (
        cur.type === TokenType.ElseIf ||
        cur.type === TokenType.Else
      ) break;

      if (cur.type === TokenType.End) {
        const next = this.peek(1);
        if (next.type === TokenType.If) break;
      }

      if (cur.type === TokenType.Newline || cur.type === TokenType.Comment) {
        this.advance();
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  // ── Select Case ───────────────────────────────────────────────────────────

  private parseSelect(): SelectStatement {
    const loc = this.loc();
    this.advance(); // Select
    this.consume(TokenType.Case, "Expected 'Case' after 'Select'");
    const subject = this.parseExpression();
    this.endStatement();
    this.skipNewlines();

    const cases: CaseClause[] = [];

    while (!this.check(TokenType.EOF)) {
      const cur = this.current();

      if (cur.type === TokenType.End) {
        const next = this.peek(1);
        if (next.type === TokenType.Select) {
          this.advance(); // End
          this.advance(); // Select
          this.endStatement();
          break;
        }
      }

      if (cur.type === TokenType.Newline || cur.type === TokenType.Comment) {
        this.advance();
        continue;
      }

      if (cur.type === TokenType.Case) {
        cases.push(this.parseCaseClause());
        continue;
      }

      // Unexpected token — skip
      this.advance();
    }

    return { ...loc, kind: "SelectStatement", subject, cases };
  }

  private parseCaseClause(): CaseClause {
    const loc = this.loc();
    this.advance(); // Case

    // Case Else
    if (this.check(TokenType.Else)) {
      this.advance();
      // May have colon + inline statement: Case Else: stmt
      const body = this.parseCaseBody();
      return { ...loc, tests: null, body };
    }

    // Parse case tests
    const tests: CaseTest[] = [];
    tests.push(this.parseCaseTest());
    while (this.check(TokenType.Comma)) {
      this.advance();
      tests.push(this.parseCaseTest());
    }

    const body = this.parseCaseBody();
    return { ...loc, tests, body };
  }

  private parseCaseTest(): CaseTest {
    // Is <op> <expr>
    if (this.check(TokenType.Is)) {
      this.advance();
      const op = this.current().value;
      this.advance();
      const expr = this.parseExpression();
      return { kind: "is", op, expr };
    }
    const expr = this.parseExpression();
    // range: expr To expr
    if (this.check(TokenType.To)) {
      this.advance();
      const to = this.parseExpression();
      return { kind: "range", from: expr, to };
    }
    return { kind: "value", expr };
  }

  private parseCaseBody(): Statement[] {
    // If a Colon follows, there's a statement on the same line
    if (this.check(TokenType.Colon)) {
      this.advance(); // consume colon
      // Parse statements until EOL (or next Case/End Select)
      const stmts: Statement[] = [];
      while (
        !this.check(TokenType.Newline) &&
        !this.check(TokenType.EOF) &&
        !this.check(TokenType.Comment) &&
        !this.check(TokenType.Case)
      ) {
        // Check for End Select on same line (unusual but safe)
        if (this.check(TokenType.End)) {
          const next = this.peek(1);
          if (next.type === TokenType.Select) break;
        }
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
        // After parseStatement, endStatement() may have consumed the newline.
        // If we're now at a newline, stop.
        if (
          this.check(TokenType.Newline) ||
          this.check(TokenType.EOF) ||
          this.check(TokenType.Comment) ||
          this.check(TokenType.Case)
        ) break;
        if (this.check(TokenType.Colon)) this.advance();
      }
      // Consume trailing newline if present
      if (this.check(TokenType.Newline)) this.advance();
      this.skipNewlines();
      return stmts;
    }

    this.endStatement();
    this.skipNewlines();
    return this.parseCaseStatements();
  }

  private parseCaseStatements(): Statement[] {
    const stmts: Statement[] = [];
    while (!this.check(TokenType.EOF)) {
      const cur = this.current();

      if (cur.type === TokenType.Case) break;
      if (cur.type === TokenType.End) {
        const next = this.peek(1);
        if (next.type === TokenType.Select) break;
      }

      if (cur.type === TokenType.Newline || cur.type === TokenType.Comment) {
        this.advance();
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  // ── For / Next ────────────────────────────────────────────────────────────

  private parseFor(): ForStatement | ForEachStatement {
    const loc = this.loc();
    this.advance(); // For

    // For Each
    if (this.check(TokenType.Each)) {
      this.advance();
      const variable = this.current().value;
      this.advance();
      this.consume(TokenType.In, "Expected 'In'");
      const collection = this.parseExpression();
      this.endStatement();
      const body = this.parseLoopBody("For");
      // consume Next [variable]
      this.consumeNext();
      return { ...loc, kind: "ForEachStatement", variable, collection, body };
    }

    // For i = expr To expr [Step expr]
    const variable = this.current().value;
    this.advance();
    this.consume(TokenType.Assign, "Expected '=' in For statement");
    const from = this.parseExpression();
    this.consume(TokenType.To, "Expected 'To' in For statement");
    const to = this.parseExpression();
    let step: Expression | null = null;
    if (this.check(TokenType.Step)) {
      this.advance();
      step = this.parseExpression();
    }
    this.endStatement();
    const body = this.parseLoopBody("For");
    this.consumeNext();
    return { ...loc, kind: "ForStatement", variable, from, to, step, body };
  }

  private consumeNext(): void {
    if (this.check(TokenType.Next)) {
      this.advance();
      // Optional variable name after Next
      if (
        this.check(TokenType.Identifier) ||
        this.isTypeKeyword(this.current().type)
      ) {
        this.advance();
      }
      this.endStatement();
    }
  }

  private parseLoopBody(kind: "For" | "Do" | "While"): Statement[] {
    const stmts: Statement[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.EOF)) {
      const cur = this.current();

      // End condition depends on kind
      if (kind === "For" && cur.type === TokenType.Next) break;
      if (kind === "Do" && cur.type === TokenType.Loop) break;
      if (kind === "While" && cur.type === TokenType.Wend) break;

      if (cur.type === TokenType.Newline || cur.type === TokenType.Comment) {
        this.advance();
        continue;
      }

      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  // ── Do … Loop ─────────────────────────────────────────────────────────────

  private parseDo(): DoStatement {
    const loc = this.loc();
    this.advance(); // Do

    // Do While/Until condition
    if (this.check(TokenType.While) || (this.check(TokenType.Identifier) && this.checkValue("until"))) {
      const whileOrUntil = this.checkValue("until") ? "Until" : "While";
      this.advance();
      const condition = this.parseExpression();
      this.endStatement();
      const body = this.parseLoopBody("Do");
      this.advance(); // Loop
      this.endStatement();
      return { ...loc, kind: "DoStatement", whileOrUntil, position: "pre", condition, body };
    }

    // Plain Do (no condition yet)
    this.endStatement();
    const body = this.parseLoopBody("Do");
    this.advance(); // Loop

    // Loop While/Until condition
    if (this.check(TokenType.While) || (this.check(TokenType.Identifier) && this.checkValue("until"))) {
      const whileOrUntil = this.checkValue("until") ? "Until" : "While";
      this.advance();
      const condition = this.parseExpression();
      this.endStatement();
      return { ...loc, kind: "DoStatement", whileOrUntil, position: "post", condition, body };
    }

    // Plain Do … Loop
    this.endStatement();
    return { ...loc, kind: "DoStatement", whileOrUntil: null, position: "none", condition: null, body };
  }

  // ── While … Wend ─────────────────────────────────────────────────────────

  private parseWhile(): WhileStatement {
    const loc = this.loc();
    this.advance(); // While
    const condition = this.parseExpression();
    this.endStatement();
    const body = this.parseLoopBody("While");
    if (this.check(TokenType.Wend)) { this.advance(); this.endStatement(); }
    return { ...loc, kind: "WhileStatement", condition, body };
  }

  // ── With … End With ───────────────────────────────────────────────────────

  private parseWith(): WithStatement {
    const loc = this.loc();
    this.advance(); // With
    const object = this.parseExpression();
    this.endStatement();
    const body = this.parseWithBody();
    return { ...loc, kind: "WithStatement", object, body };
  }

  private parseWithBody(): Statement[] {
    const stmts: Statement[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.EOF)) {
      const cur = this.current();
      if (cur.type === TokenType.End) {
        const next = this.peek(1);
        if (next.type === TokenType.With) {
          this.advance(); // End
          this.advance(); // With
          this.endStatement();
          break;
        }
      }
      if (cur.type === TokenType.Newline || cur.type === TokenType.Comment) {
        this.advance();
        continue;
      }
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  // ── Exit ──────────────────────────────────────────────────────────────────

  private parseExit(): ExitStatement {
    const loc = this.loc();
    this.advance(); // Exit
    const what = this.current();
    let kind: ExitStatement["what"] = "Sub";
    if (what.type === TokenType.Sub) kind = "Sub";
    else if (what.type === TokenType.Function) kind = "Function";
    else if (what.type === TokenType.For) kind = "For";
    else if (what.type === TokenType.Do) kind = "Do";
    else if (what.type === TokenType.While) kind = "While";
    this.advance();
    this.endStatement();
    return { ...loc, kind: "ExitStatement", what: kind };
  }

  // ── Labels and GoTo ──────────────────────────────────────────────────────

  /** A label is an identifier followed by ':' as the first token on its line. */
  private isLabelAhead(): boolean {
    const tok = this.current();
    if (tok.type !== TokenType.Identifier) return false;
    if (this.peek(1).type !== TokenType.Colon) return false;
    return this.pos === 0 || this.tokens[this.pos - 1].type === TokenType.Newline;
  }

  private parseLabel(): LabelStatement {
    const loc = this.loc();
    const name = this.advance().value;
    this.advance(); // :
    return { ...loc, kind: "LabelStatement", name };
  }

  private parseGoTo(): GoToStatement {
    const loc = this.loc();
    this.advance(); // GoTo
    const label = this.current().value;
    this.advance();
    this.endStatement();
    return { ...loc, kind: "GoToStatement", label };
  }

  // ── On Error ─────────────────────────────────────────────────────────────

  private parseOnError(): OnErrorStatement {
    const loc = this.loc();
    this.advance(); // On
    this.consume(TokenType.Error, "Expected 'Error'");

    if (this.check(TokenType.Resume)) {
      this.advance();
      // "Next"
      if (this.check(TokenType.Next)) {
        this.advance();
        this.endStatement();
        return { ...loc, kind: "OnErrorStatement", mode: "ResumeNext", label: null };
      }
      // "Resume 0" is unusual but handle
      this.endStatement();
      return { ...loc, kind: "OnErrorStatement", mode: "ResumeNext", label: null };
    }

    if (this.check(TokenType.GoTo)) {
      this.advance();
      // GoTo 0 means "clear error handler"
      if (this.current().value === "0") {
        this.advance();
        this.endStatement();
        return { ...loc, kind: "OnErrorStatement", mode: "GoTo0", label: null };
      }
      const label = this.current().value;
      this.advance();
      this.endStatement();
      return { ...loc, kind: "OnErrorStatement", mode: "GoToLabel", label };
    }

    // Unknown form — parse as unsupported
    this.collectLineRaw();
    this.endStatement();
    return { ...loc, kind: "OnErrorStatement", mode: "ResumeNext", label: null };
  }

  // ── Unsupported line ──────────────────────────────────────────────────────

  private parseUnsupportedLine(): UnsupportedStatement {
    const loc = this.loc();
    let construct = this.current().value;
    this.advance();
    // `Print #1, x` is the file statement; REQ-12.2 names it "Print #".
    if (this.current().type === TokenType.Hash && /^(print|input|write|get|put)$/i.test(construct)) {
      construct += " #";
    }
    const raw = construct + " " + this.collectLineRaw();
    this.endStatement();
    return { ...loc, kind: "UnsupportedStatement", construct, raw };
  }

  // ── Expressions ───────────────────────────────────────────────────────────
  // Precedence (lowest to highest):
  //  1. Or
  //  2. And
  //  3. Not
  //  4. Comparison: = <> < > <= >= Is Like
  //  5. Concat: &
  //  6. Add/Sub: + -
  //  7. Mul/Div: * / \ Mod
  //  8. Unary: - Not
  //  9. Power: ^
  // 10. Postfix: member, index, call

  parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.check(TokenType.Or)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseAnd();
      const bin: BinaryExpr = { ...loc, kind: "BinaryExpr", op, left, right };
      left = bin;
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();
    while (this.check(TokenType.And)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseNot();
      const bin: BinaryExpr = { ...loc, kind: "BinaryExpr", op, left, right };
      left = bin;
    }
    return left;
  }

  private parseNot(): Expression {
    if (this.check(TokenType.Not)) {
      const loc = this.loc();
      const op = this.advance().value;
      const operand = this.parseNot();
      const un: UnaryExpr = { ...loc, kind: "UnaryExpr", op, operand };
      return un;
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let left = this.parseConcat();
    while (true) {
      const t = this.current();
      if (
        t.type === TokenType.Assign || // = in expression context
        t.type === TokenType.Neq ||
        t.type === TokenType.Lt ||
        t.type === TokenType.Lte ||
        t.type === TokenType.Gt ||
        t.type === TokenType.Gte ||
        t.type === TokenType.Is ||
        t.type === TokenType.Like
      ) {
        const loc = this.loc();
        const op = this.advance().value;
        // Handle "Is Not"
        if (t.type === TokenType.Is && this.check(TokenType.Not)) {
          const notOp = this.advance().value;
          const right = this.parseConcat();
          const bin: BinaryExpr = { ...loc, kind: "BinaryExpr", op: op + " " + notOp, left, right };
          left = bin;
        } else {
          const right = this.parseConcat();
          const bin: BinaryExpr = { ...loc, kind: "BinaryExpr", op, left, right };
          left = bin;
        }
      } else {
        break;
      }
    }
    return left;
  }

  private parseConcat(): Expression {
    let left = this.parseAddSub();
    while (this.check(TokenType.Concat)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseAddSub();
      const bin: BinaryExpr = { ...loc, kind: "BinaryExpr", op, left, right };
      left = bin;
    }
    return left;
  }

  private parseAddSub(): Expression {
    let left = this.parseMulDiv();
    while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseMulDiv();
      const bin: BinaryExpr = { ...loc, kind: "BinaryExpr", op, left, right };
      left = bin;
    }
    return left;
  }

  private parseMulDiv(): Expression {
    let left = this.parseUnary();
    while (
      this.check(TokenType.Star) ||
      this.check(TokenType.Slash) ||
      this.check(TokenType.Backslash) ||
      this.check(TokenType.Mod)
    ) {
      const loc = this.loc();
      const op = this.advance().value;
      const right = this.parseUnary();
      const bin: BinaryExpr = { ...loc, kind: "BinaryExpr", op, left, right };
      left = bin;
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.check(TokenType.Minus)) {
      const loc = this.loc();
      const op = this.advance().value;
      const operand = this.parseUnary();
      const un: UnaryExpr = { ...loc, kind: "UnaryExpr", op, operand };
      return un;
    }
    if (this.check(TokenType.Plus)) {
      this.advance(); // unary + is a no-op
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): Expression {
    return this.continuePower(this.parsePostfix());
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();
    while (true) {
      if (this.check(TokenType.Dot)) {
        const loc = this.loc();
        this.advance(); // .
        const member = this.current().value;
        this.advance();
        // If followed by (, it's a method call
        if (this.check(TokenType.LParen)) {
          const memberExpr: MemberExpr = { ...loc, kind: "MemberExpr", object: expr, member };
          this.advance(); // (
          const args = this.parseArgList();
          this.consume(TokenType.RParen, "Expected ')'");
          const call: CallExpr = { ...loc, kind: "CallExpr", callee: memberExpr, args };
          expr = call;
        } else {
          const memberExpr: MemberExpr = { ...loc, kind: "MemberExpr", object: expr, member };
          expr = memberExpr;
        }
        continue;
      }

      if (this.check(TokenType.Bang)) {
        const loc = this.loc();
        this.advance(); // !
        const member = this.current().value;
        this.advance();
        const memberExpr: MemberExpr = { ...loc, kind: "MemberExpr", object: expr, member };
        expr = memberExpr;
        continue;
      }

      if (this.check(TokenType.LParen)) {
        const loc = this.loc();
        this.advance(); // (
        const args = this.parseArgList();
        this.consume(TokenType.RParen, "Expected ')'");
        // Could be index or call — treat as CallExpr/IndexExpr
        if (expr.kind === "Identifier" || expr.kind === "MemberExpr" || expr.kind === "CallExpr") {
          const call: CallExpr = { ...loc, kind: "CallExpr", callee: expr, args };
          expr = call;
        } else {
          const idx: IndexExpr = { ...loc, kind: "IndexExpr", object: expr, args };
          expr = idx;
        }
        continue;
      }

      break;
    }
    return expr;
  }

  private parseArgList(): Expression[] {
    const args: Expression[] = [];
    if (this.check(TokenType.RParen)) return args;
    // Allow empty positional args: fn(, x) or fn(x, ,y)
    while (!this.check(TokenType.RParen) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.Comma)) {
        // empty argument
        args.push(this.makeNothingExpr());
        this.advance();
        continue;
      }
      args.push(this.parseExpression());
      if (this.check(TokenType.Comma)) {
        this.advance();
        // If next is ) then there was a trailing comma
        if (this.check(TokenType.RParen)) break;
      } else {
        break;
      }
    }
    return args;
  }

  private makeNothingExpr(): NothingExpr {
    return { kind: "NothingExpr", module: this.moduleName, line: this.current().line };
  }

  /** `&H`/`&O` literal: 16-bit or 32-bit two's complement, see design 2.2. */
  private radixLiteral(tok: Token, loc: NodeLocation): Literal {
    const m = /^&([hHoO])([0-9a-fA-F]*)([%&^]?)$/.exec(tok.value);
    if (!m) throw new ParseError(`Invalid literal '${tok.value}'`, this.moduleName, tok.line, tok.col);
    const raw = parseInt(m[2], m[1].toLowerCase() === "h" ? 16 : 8);
    const suffix = m[3];
    if (suffix === "^") throw new UnsupportedError(this.moduleName, tok.line, "LongLong literal");
    const tooBig = (): never => {
      throw new ParseError(`Overflow in literal '${tok.value}'`, this.moduleName, tok.line, tok.col);
    };
    const asInteger = (): Literal => {
      if (raw > 0xffff) return tooBig();
      return { ...loc, kind: "Literal", value: raw >= 0x8000 ? raw - 0x10000 : raw, typeName: "Integer" };
    };
    const asLong = (): Literal => {
      if (raw > 0xffffffff) return tooBig();
      return { ...loc, kind: "Literal", value: raw >= 0x80000000 ? raw - 0x100000000 : raw, typeName: "Long" };
    };
    if (suffix === "%") return asInteger();
    if (suffix === "&") return asLong();
    return raw <= 0xffff ? asInteger() : asLong();
  }

  private parsePrimary(): Expression {
    const tok = this.current();
    const loc = this.locAt(tok);

    // Literals
    if (tok.type === TokenType.IntegerLiteral || tok.type === TokenType.LongLiteral) {
      this.advance();
      if (tok.value.startsWith("&")) return this.radixLiteral(tok, loc);
      const value = parseFloat(tok.value);
      // Unsuffixed literals take the smallest fitting type, as in VBA; "&" forces Long.
      const isInteger =
        tok.type === TokenType.IntegerLiteral
          ? value >= -32768 && value <= 32767
          : tok.value.endsWith("%");
      const lit: Literal = { ...loc, kind: "Literal", value, typeName: isInteger ? "Integer" : "Long" };
      return lit;
    }
    if (tok.type === TokenType.DoubleLiteral) {
      this.advance();
      const lit: Literal = { ...loc, kind: "Literal", value: parseFloat(tok.value), typeName: "Double" };
      return lit;
    }
    if (tok.type === TokenType.StringLiteral) {
      this.advance();
      // Strip surrounding quotes and unescape ""
      const raw = tok.value;
      const inner = raw.length >= 2 ? raw.slice(1, -1).replace(/""/g, '"') : raw;
      const lit: Literal = { ...loc, kind: "Literal", value: inner, typeName: "String" };
      return lit;
    }
    if (tok.type === TokenType.DateLiteral) {
      this.advance();
      const lit: Literal = { ...loc, kind: "Literal", value: tok.value, typeName: "Date" };
      return lit;
    }
    if (tok.type === TokenType.True) {
      this.advance();
      const lit: Literal = { ...loc, kind: "Literal", value: true, typeName: "Boolean" };
      return lit;
    }
    if (tok.type === TokenType.False) {
      this.advance();
      const lit: Literal = { ...loc, kind: "Literal", value: false, typeName: "Boolean" };
      return lit;
    }
    if (tok.type === TokenType.Nothing) {
      this.advance();
      const nothing: NothingExpr = { ...loc, kind: "NothingExpr" };
      return nothing;
    }

    // New ClassName
    if (tok.type === TokenType.New) {
      this.advance();
      const className = this.parseDottedName();
      const newExpr: NewExpr = { ...loc, kind: "NewExpr", className };
      return newExpr;
    }

    // Parenthesised expression
    if (tok.type === TokenType.LParen) {
      this.advance();
      const expr = this.parseExpression();
      this.consume(TokenType.RParen, "Expected ')'");
      return expr;
    }

    // With-member: .Member (inside With block)
    if (tok.type === TokenType.Dot) {
      this.advance();
      const member = this.current().value;
      this.advance();
      const wm: WithMemberExpr = { ...loc, kind: "WithMemberExpr", member };
      return wm;
    }

    // Identifier (or keyword used as identifier: e.g. type names, Err, etc.)
    if (this.isIdentifierLike(tok.type)) {
      this.advance();
      const id: IdentifierExpr = { ...loc, kind: "Identifier", name: tok.value };
      return id;
    }

    // Hash followed by number = file number literal — treat as a special identifier
    if (tok.type === TokenType.Hash) {
      this.advance();
      const num = this.current();
      this.advance();
      const id: IdentifierExpr = { ...loc, kind: "Identifier", name: "#" + num.value };
      return id;
    }

    // Fallback: treat unknown token as identifier to avoid crashing
    this.advance();
    const id: IdentifierExpr = { ...loc, kind: "Identifier", name: tok.value };
    return id;
  }

  private isIdentifierLike(type: TokenType): boolean {
    // All type names and many keywords can appear as identifiers in expressions
    return (
      type === TokenType.Identifier ||
      type === TokenType.TInteger ||
      type === TokenType.TLong ||
      type === TokenType.TDouble ||
      type === TokenType.TString ||
      type === TokenType.TBoolean ||
      type === TokenType.TDate ||
      type === TokenType.TVariant ||
      type === TokenType.TObject ||
      type === TokenType.TCurrency ||
      type === TokenType.TSingle ||
      type === TokenType.TByte ||
      type === TokenType.TLongLong ||
      type === TokenType.TLongPtr ||
      // Common keywords used as function names in expressions
      type === TokenType.Input ||
      type === TokenType.Output ||
      type === TokenType.Error ||
      type === TokenType.Static ||
      type === TokenType.Text ||
      type === TokenType.Binary ||
      type === TokenType.Append ||
      type === TokenType.Random ||
      type === TokenType.Get ||
      type === TokenType.Put ||
      type === TokenType.Print
    );
  }

  private isTypeKeyword(type: TokenType): boolean {
    return (
      type === TokenType.TInteger ||
      type === TokenType.TLong ||
      type === TokenType.TDouble ||
      type === TokenType.TString ||
      type === TokenType.TBoolean ||
      type === TokenType.TDate ||
      type === TokenType.TVariant ||
      type === TokenType.TObject ||
      type === TokenType.TCurrency ||
      type === TokenType.TSingle ||
      type === TokenType.Identifier
    );
  }
}
