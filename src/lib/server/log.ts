import { config } from './config';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(config.logLevel as Level) in LEVELS ? (config.logLevel as Level) : 'info'];

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
	if (LEVELS[level] < threshold) return;
	const time = new Date().toISOString();
	const prefix = `${time} ${level.toUpperCase()} restauranteer`;
	if (meta) console.log(`${prefix} ${msg}`, meta);
	else console.log(`${prefix} ${msg}`);
}

export const log = {
	debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
	info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
	warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
	error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta)
};
