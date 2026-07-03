/** Tiny structured logger — no dependency, timestamped, level-tagged. */
const ts = () => new Date().toISOString();

function emit(level, scope, msg, extra) {
  const line = `${ts()} ${level.padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}

export function logger(scope) {
  return {
    info: (msg, extra) => emit('INFO', scope, msg, extra),
    warn: (msg, extra) => emit('WARN', scope, msg, extra),
    error: (msg, extra) => emit('ERROR', scope, msg, extra),
    debug: (msg, extra) => {
      if (process.env.DEBUG) emit('DEBUG', scope, msg, extra);
    },
  };
}
