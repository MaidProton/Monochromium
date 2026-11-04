export interface TestStorage extends Storage {
  readonly values: ReadonlyMap<string, string>;
}

export const installTestStorage = (): TestStorage => {
  const values = new Map<string, string>();
  const storage: TestStorage = {
    values,
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  return storage;
};

export const uninstallTestStorage = (): void => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "window");
};
