// packages/vba — public barrel

export { tokenize } from "./lexer.js";
export { parse } from "./parser.js";
export { ParseError, UnsupportedError, RuntimeError } from "./errors.js";
export { Interpreter, FatalError } from "./interpreter.js";
export type { RunOptions, RunResult, UnsupportedHit } from "./interpreter.js";
export { MemoryWorkbook } from "./memory-workbook.js";
export type { MemorySheetInit } from "./memory-workbook.js";
export type { WorkbookHandle, SheetHandle, RangeHandle, VBAValue, XlDirection } from "./host.js";
export { runMacro } from "./run.js";
export {
  roundHalfEven,
  roundHalfEvenTo,
  toInteger,
  toLong,
  intDiv,
  vbaMod,
  dateSerial,
  excelSerialToVbaDate,
  vbaDateToExcelSerial,
} from "./coerce.js";
export type {
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
