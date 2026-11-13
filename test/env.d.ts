// What the tests set in the environment before they load Studio's modules: a test that reads FIRSTPASS_DATA_DIR
// sets it first, at its top, to a data folder of its own (and FIRSTPASS_LOCAL_DIR, for what stays on this Mac).
declare namespace NodeJS {
  interface ProcessEnv { FIRSTPASS_DATA_DIR: string; FIRSTPASS_LOCAL_DIR: string }
}
