/**
 * Returns direction metadata for mixed-script fragments such as phone numbers and URLs.
 */
export function getBidiProps(direction = "ltr") {
  return {
    dir: direction,
  };
}
