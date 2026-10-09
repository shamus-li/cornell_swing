import isEmail from "validator/es/lib/isEmail"

// Requires a full address like jane@cornell.edu; the browser's own check also accepts jane@cornell.
export function isValidEmail(value: string): boolean {
  return value.length <= 254 && isEmail(value)
}
