export type AOSPayload = Record<string, unknown>;

/* How one model's Goovee fields translate to AOS's own. Both lists are per
 * model: `fullName` exists on Partner, Address, Product, ProjectTask and User,
 * and AOS recomputes it on some and stores what it is given on others. The
 * caller that knows which model it writes declares them, next to that model's
 * other AOS knowledge. */
export type AOSFieldMapping = {
  /* Fields the Goovee schema spells differently from AOS, on the same column.
   * Dropping a rename makes AOS ignore the field without a word. */
  renames?: Record<string, string>;
  /* Fields AOS recomputes when it saves the record. Sending them is ignored at
   * best, and lets Goovee's own value drift from the ERP convention at worst. */
  computed?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* Returned instead of a value when the field must not reach AOS at all. */
const OMIT = Symbol('omit');

function toAOSValue(key: string, value: unknown): unknown | typeof OMIT {
  if (key === 'id' || key === 'version') return Number(value);

  /* A list sent over ws/rest REPLACES the collection instead of adding to it,
   * so a to-many write must never be translated silently. The sites that
   * manipulate collections keep writing through the ORM on purpose. */
  if (isRecord(value)) {
    for (const op of ['select', 'create', 'update', 'remove'] as const) {
      if (Array.isArray(value[op])) {
        throw new Error(
          `toAOSPayload: refusing to translate the collection "${key}" ` +
            `(a ws/rest list replaces the collection); write it through the ORM`,
        );
      }
    }
  }

  if (isRecord(value) && isRecord(value.select)) {
    const id = value.select.id;
    /* A relation resolved from an optional source (`country?.id`) arrives as
     * {select: {id: undefined}}; sending {id: NaN} would fail the save. */
    if (id == null) return OMIT;
    return {id: Number(id)};
  }

  /* AOP accepts a nested record for a to-one relation, so an inline create
   * translates to the record itself. It is translated structurally only — ids,
   * relation shape, collection refusal — because a mapping describes one model
   * and this record belongs to another. AOS also runs only the request model's
   * repository, so what it recomputes for a nested record it does not recompute
   * here: a record whose mapping matters is saved through its own call. */
  if (isRecord(value) && isRecord(value.create)) {
    return toAOSPayload(value.create);
  }

  if (isRecord(value) && isRecord(value.update)) {
    return toAOSPayload(value.update);
  }

  return value;
}

/* Translates an ORM-shaped payload — an UpdateArgs/CreateArgs object, with its
 * {select: {id}} relations and Goovee field names — into what ws/rest expects.
 * A payload written AOS-native to begin with needs no translation and goes
 * straight to save(), which is what the ticketing and website writes do: this
 * is the translator for data that already exists in ORM shape, not a gateway
 * every AOS write has to pass through. */
export function toAOSPayload(
  data: Record<string, unknown>,
  mapping: AOSFieldMapping = {},
): AOSPayload {
  const renames = mapping.renames ?? {};
  const computed = new Set(mapping.computed ?? []);
  const payload: AOSPayload = {};

  for (const [key, value] of Object.entries(data)) {
    if (computed.has(key) || value === undefined) continue;

    const aosValue = toAOSValue(key, value);
    if (aosValue === OMIT) continue;

    payload[renames[key] ?? key] = aosValue;
  }

  return payload;
}
