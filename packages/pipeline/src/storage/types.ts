/** Where derivatives are stored and how they are addressed. */
export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Public URL for a key. Pure: never touches the network or disk. */
  url(key: string): string;
  /** Keys under a prefix (for example `colors__red_door/`). */
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
  /**
   * Optional housekeeping run by `--prune`: remove leftovers that hold no
   * key, such as empty folders and interrupted writes. Returns what it removed.
   */
  sweep?(): Promise<string[]>;
}
