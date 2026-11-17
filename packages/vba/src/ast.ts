// ─── Token types ────────────────────────────────────────────────────────────

export const enum TokenType {
  // Literals
  IntegerLiteral,
  LongLiteral,
  DoubleLiteral,
  StringLiteral,
  DateLiteral,
  BooleanLiteral,

  // Keywords
  Sub,
  Function,
  End,
  Dim,
  Const,
  If,
  ElseIf,
  Else,
  Then,
  Select,
  Case,
  For,
  Each,
  Next,
  To,
  Step,
  Do,
  Loop,
  While,
  Wend,
  Exit,
  With,
  Set,
  Let,
  New,
  Nothing,
  True,
  False,
  And,
  Or,
  Not,
  Mod,
  Is,
  Like,
  ByVal,
  ByRef,
  As,
  Option,
  Base,
  Explicit,
  Compare,
  Text,
  Binary,
  ReDim,
  Preserve,
  Public,
  Private,
  Friend,
  Protected,
  Static,
  On,
  Error,
  Resume,
  GoTo,
  Return,
  Declare,
  PtrSafe,
  Lib,
  Alias,
  In,
  Open,
  Close,
  Print,
  Input,
  Write,
  Get,
  Put,
  Output,
  Append,
  Random,
  Binary_ /* "Binary" keyword for file mode */,

  // Type names
  TInteger,
  TLong,
  TDouble,
  TString,
  TBoolean,
  TDate,
  TVariant,
  TObject,
  TCurrency,
  TSingle,
  TByte,
  TLongLong,
  TLongPtr,

  // Identifiers and operators
  Identifier,
  Comment,
  Assign, // =
  NamedAssign, // :=
  Concat, // &
  Plus,
  Minus,
  Star,
  Slash,
  Backslash,
  Caret,
  Lt,
  Lte,
  Gt,
  Gte,
  Eq, // = used in comparison context (same token as Assign, disambiguated by parser)
  Neq, // <>
  Dot,
  Bang, // !
  LParen,
  RParen,
  Comma,
  Colon,
  Hash,
  Newline,
  Continuation, // _ at EOL (consumed by lexer, never emitted)
  Unknown,
  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

// ─── AST node types ─────────────────────────────────────────────────────────

export interface NodeLocation {
  module: string;
  line: number;
}

// ── Module ──────────────────────────────────────────────────────────────────

export interface ModuleOptions {
  explicit: boolean; // Option Explicit
  base: 0 | 1; // Option Base
  compareMode: "binary" | "text"; // Option Compare
}

export interface ModuleAST {
  kind: "Module";
  module: string;
  options: ModuleOptions;
  declarations: Declaration[];
  procedures: ProcedureDecl[];
}

// ── Declarations ────────────────────────────────────────────────────────────

export type Declaration = DimStatement | ConstStatement | UnsupportedStatement;

export interface DimDeclarator {
  name: string;
  typeName: string | null;
  /** array dimensions, e.g. [(1,10)] for (1 To 10) or [(null,5)] for (5) */
  dimensions: Array<[Expression | null, Expression]> | null;
}

export interface DimStatement extends NodeLocation {
  kind: "DimStatement";
  scope: "Local" | "Module" | "Public";
  declarators: DimDeclarator[];
}

export interface ConstDeclarator {
  name: string;
  typeName: string | null;
  value: Expression;
}

export interface ConstStatement extends NodeLocation {
  kind: "ConstStatement";
  scope: "Local" | "Module" | "Public";
  declarators: ConstDeclarator[];
}

// ── Procedures ──────────────────────────────────────────────────────────────

export interface Parameter {
  name: string;
  typeName: string | null;
  passing: "ByVal" | "ByRef";
  optional: boolean;
  defaultValue: Expression | null;
  isArray: boolean;
}

export interface SubDecl extends NodeLocation {
  kind: "SubDecl";
  name: string;
  scope: "Public" | "Private" | "Friend" | "Static" | "";
  params: Parameter[];
  body: Statement[];
}

export interface FunctionDecl extends NodeLocation {
  kind: "FunctionDecl";
  name: string;
  scope: "Public" | "Private" | "Friend" | "Static" | "";
  params: Parameter[];
  returnType: string | null;
  body: Statement[];
}

export type ProcedureDecl = SubDecl | FunctionDecl;

// ── Statements ──────────────────────────────────────────────────────────────

export type Statement =
  | DimStatement
  | ConstStatement
  | AssignStatement
  | SetStatement
  | CallStatement
  | IfStatement
  | SelectStatement
  | ForStatement
  | ForEachStatement
  | DoStatement
  | WhileStatement
  | WithStatement
  | ExitStatement
  | ReDimStatement
  | OnErrorStatement
  | UnsupportedStatement
  | ReturnStatement;

export interface AssignStatement extends NodeLocation {
  kind: "AssignStatement";
  /** target may be a member expr, index expr, or identifier */
  target: Expression;
  value: Expression;
}

export interface SetStatement extends NodeLocation {
  kind: "SetStatement";
  target: Expression;
  value: Expression;
}

export interface CallStatement extends NodeLocation {
  kind: "CallStatement";
  /** The called expression (may be a simple identifier, member chain, or call) */
  callee: Expression;
  args: Expression[];
}

export interface ElseIfClause extends NodeLocation {
  condition: Expression;
  body: Statement[];
}

export interface IfStatement extends NodeLocation {
  kind: "IfStatement";
  condition: Expression;
  thenBody: Statement[];
  elseIfs: ElseIfClause[];
  elseBody: Statement[] | null;
  /** true when the entire if was on one line: If x Then y = 1 */
  singleLine: boolean;
}

export interface CaseClause extends NodeLocation {
  /** null means Case Else */
  tests: CaseTest[] | null;
  body: Statement[];
}

export type CaseTest =
  | { kind: "value"; expr: Expression }
  | { kind: "range"; from: Expression; to: Expression }
  | { kind: "is"; op: string; expr: Expression };

export interface SelectStatement extends NodeLocation {
  kind: "SelectStatement";
  subject: Expression;
  cases: CaseClause[];
}

export interface ForStatement extends NodeLocation {
  kind: "ForStatement";
  variable: string;
  from: Expression;
  to: Expression;
  step: Expression | null;
  body: Statement[];
}

export interface ForEachStatement extends NodeLocation {
  kind: "ForEachStatement";
  variable: string;
  collection: Expression;
  body: Statement[];
}

export interface DoStatement extends NodeLocation {
  kind: "DoStatement";
  /** pre-test: Do While/Until … Loop; post-test: Do … Loop While/Until; plain: Do … Loop */
  whileOrUntil: "While" | "Until" | null;
  position: "pre" | "post" | "none";
  condition: Expression | null;
  body: Statement[];
}

export interface WhileStatement extends NodeLocation {
  kind: "WhileStatement";
  condition: Expression;
  body: Statement[];
}

export interface WithStatement extends NodeLocation {
  kind: "WithStatement";
  object: Expression;
  body: Statement[];
}

export interface ExitStatement extends NodeLocation {
  kind: "ExitStatement";
  what: "Sub" | "Function" | "For" | "Do" | "While";
}

export interface ReDimStatement extends NodeLocation {
  kind: "ReDimStatement";
  preserve: boolean;
  variable: string;
  dimensions: Array<[Expression | null, Expression]>;
}

export interface OnErrorStatement extends NodeLocation {
  kind: "OnErrorStatement";
  mode: "ResumeNext" | "GoTo0" | "GoToLabel";
  label: string | null;
}

export interface UnsupportedStatement extends NodeLocation {
  kind: "UnsupportedStatement";
  construct: string;
  /** Raw tokens on the line */
  raw: string;
}

export interface ReturnStatement extends NodeLocation {
  kind: "ReturnStatement";
}

// ── Expressions ─────────────────────────────────────────────────────────────

export type Expression =
  | Literal
  | IdentifierExpr
  | BinaryExpr
  | UnaryExpr
  | MemberExpr
  | IndexExpr
  | CallExpr
  | NothingExpr
  | WithMemberExpr
  | NewExpr;

export interface Literal extends NodeLocation {
  kind: "Literal";
  value: number | string | boolean;
  typeName: "Integer" | "Long" | "Double" | "String" | "Boolean" | "Date";
}

export interface IdentifierExpr extends NodeLocation {
  kind: "Identifier";
  name: string;
}

export interface BinaryExpr extends NodeLocation {
  kind: "BinaryExpr";
  op: string;
  left: Expression;
  right: Expression;
}

export interface UnaryExpr extends NodeLocation {
  kind: "UnaryExpr";
  op: string;
  operand: Expression;
}

/** obj.member */
export interface MemberExpr extends NodeLocation {
  kind: "MemberExpr";
  object: Expression;
  member: string;
}

/** arr(index, ...) */
export interface IndexExpr extends NodeLocation {
  kind: "IndexExpr";
  object: Expression;
  args: Expression[];
}

/** fn(arg, ...) — also method calls where obj.method(args) is MemberExpr + CallExpr */
export interface CallExpr extends NodeLocation {
  kind: "CallExpr";
  callee: Expression;
  args: Expression[];
}

export interface NothingExpr extends NodeLocation {
  kind: "NothingExpr";
}

/** .Member inside a With block */
export interface WithMemberExpr extends NodeLocation {
  kind: "WithMemberExpr";
  member: string;
}

export interface NewExpr extends NodeLocation {
  kind: "NewExpr";
  className: string;
}
