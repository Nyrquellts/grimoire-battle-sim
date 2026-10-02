export type RegistryValidator<T> = (entry: T) => void;

/** Typed map-backed content registry. Data modules register entries; rules only query them. */
export class Registry<T extends { id?: string }> {
  readonly #items = new Map<string, Readonly<T>>();
  readonly #validate: RegistryValidator<T> | null;

  constructor(validate: RegistryValidator<T> | null = null) { this.#validate = validate; }

  /** Adds an immutable entry. */
  add(id: string, entry: T): Readonly<T> {
    if (!id) throw new Error('Registry id is required.');
    if (this.#items.has(id)) throw new Error(`Duplicate registry id: ${id}`);
    const value = Object.freeze({ ...entry, id });
    this.#validate?.(value as T);
    this.#items.set(id, value);
    return value;
  }

  /** Returns an entry or undefined. */
  get(id: string): Readonly<T> | undefined { return this.#items.get(id); }
  /** Returns an entry or throws. */
  require(id: string): Readonly<T> { const value = this.get(id); if (!value) throw new Error(`Unknown registry id: ${id}`); return value; }
  /** Returns whether an id exists. */
  has(id: string): boolean { return this.#items.has(id); }
  /** Iterates immutable values. */
  values(): IterableIterator<Readonly<T>> { return this.#items.values(); }
  /** Number of registered rows. */
  get size(): number { return this.#items.size; }
}
