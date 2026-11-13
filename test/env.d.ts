// What the tests set in the environment before they load Studio's modules: a test that reads FIRSTPASS_DATA_DIR
// sets it first, at its top, to a data folder of its own.
declare namespace NodeJS {
  interface ProcessEnv { FIRSTPASS_DATA_DIR: string }
}
