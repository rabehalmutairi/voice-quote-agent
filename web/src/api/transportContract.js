const REQUIRED_METHODS = Object.freeze([
  "createTask",
  "submitAnswers",
  "startTask",
  "getTask",
  "subscribe",
]);

/**
 * @typedef {Object} TaskTransport
 * @property {(request: string | Object) => Promise<Object>} createTask
 * @property {(taskId: string, answers: Object) => Promise<Object>} submitAnswers
 * @property {(taskId: string) => Promise<Object>} startTask
 * @property {(taskId: string) => Promise<Object>} getTask
 * @property {(taskId: string, onEvent: (event: Object) => void) => () => void} subscribe
 */

/**
 * Runtime assertion for mock and future real task transports.
 * This validates the frontend integration boundary, not backend authorization.
 * @template T
 * @param {T} transport
 * @returns {T}
 */
export function assertTaskTransport(transport) {
  const missingMethod = REQUIRED_METHODS.find(
    (method) => typeof transport?.[method] !== "function",
  );

  if (missingMethod) {
    throw new TypeError(`Task transport is missing method: ${missingMethod}`);
  }

  return transport;
}
