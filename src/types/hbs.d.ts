declare module 'hbs' {
  const hbs: {
    registerHelper(name: string, helper: (...args: any[]) => unknown): void;
  };

  export = hbs;
}
