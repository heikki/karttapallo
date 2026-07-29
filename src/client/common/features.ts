// Bun's static-serve env inlining (bunfig.toml [serve.static] env="PUBLIC_*")
// only replaces `process.env.X` when X is actually set. When unset, the literal
// `process.env.X` access survives into the browser bundle and throws
// `process is not defined`. The try/catch shields us from that case so the app
// loads cleanly without a .env file.
function readPublicEnv(name: 'PUBLIC_MML_API_KEY' | 'PUBLIC_ORS_API_KEY') {
  try {
    if (name === 'PUBLIC_MML_API_KEY') {
      return process.env.PUBLIC_MML_API_KEY ?? '';
    }
    return process.env.PUBLIC_ORS_API_KEY ?? '';
  } catch {
    return '';
  }
}

export const MML_API_KEY = readPublicEnv('PUBLIC_MML_API_KEY');
export const ORS_API_KEY = readPublicEnv('PUBLIC_ORS_API_KEY');
export const HAS_MML = MML_API_KEY !== '';
export const HAS_ROUTING = ORS_API_KEY !== '';
