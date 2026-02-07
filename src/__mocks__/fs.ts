import { vi } from 'vitest';

// Import the actual fs module using require to avoid circular mock issues
const actualFs = require('fs') as typeof import('fs');

// Mock existsSync to return true by default
export const existsSync = vi.fn((path: string) => {
  return actualFs.existsSync(path);
});

// Re-export everything from the actual fs module
export const accessSync = actualFs.accessSync;
export const appendFileSync = actualFs.appendFileSync;
export const chmodSync = actualFs.chmodSync;
export const chownSync = actualFs.chownSync;
export const closeSync = actualFs.closeSync;
export const copyFileSync = actualFs.copyFileSync;
export const cpSync = actualFs.cpSync;
export const createReadStream = actualFs.createReadStream;
export const createWriteStream = actualFs.createWriteStream;
export const fchmodSync = actualFs.fchmodSync;
export const fchownSync = actualFs.fchownSync;
export const fdatasyncSync = actualFs.fdatasyncSync;
export const fstatSync = actualFs.fstatSync;
export const fsyncSync = actualFs.fsyncSync;
export const ftruncateSync = actualFs.ftruncateSync;
export const futimesSync = actualFs.futimesSync;
export const lchmodSync = actualFs.lchmodSync;
export const lchownSync = actualFs.lchownSync;
export const linkSync = actualFs.linkSync;
export const lstatSync = actualFs.lstatSync;
export const lutimesSync = actualFs.lutimesSync;
export const mkdirSync = actualFs.mkdirSync;
export const mkdtempSync = actualFs.mkdtempSync;
export const openSync = actualFs.openSync;
export const opendirSync = actualFs.opendirSync;
export const readFileSync = actualFs.readFileSync;
export const readSync = actualFs.readSync;
export const readdirSync = actualFs.readdirSync;
export const readlinkSync = actualFs.readlinkSync;
export const realpathSync = actualFs.realpathSync;
export const renameSync = actualFs.renameSync;
export const rmdirSync = actualFs.rmdirSync;
export const rmSync = actualFs.rmSync;
export const statSync = actualFs.statSync;
export const symlinkSync = actualFs.symlinkSync;
export const truncateSync = actualFs.truncateSync;
export const unlinkSync = actualFs.unlinkSync;
export const utimesSync = actualFs.utimesSync;
export const writeFileSync = actualFs.writeFileSync;
export const writeSync = actualFs.writeSync;
export const watch = actualFs.watch;
export const watchFile = actualFs.watchFile;
export const unwatchFile = actualFs.unwatchFile;
export const promises = actualFs.promises;
export const constants = actualFs.constants;
export const Stats = actualFs.Stats;
export const Dirent = actualFs.Dirent;
export const ReadStream = actualFs.ReadStream;
export const WriteStream = actualFs.WriteStream;
export const Dir = actualFs.Dir;
export const access = actualFs.access;
export const appendFile = actualFs.appendFile;
export const chmod = actualFs.chmod;
export const chown = actualFs.chown;
export const close = actualFs.close;
export const copyFile = actualFs.copyFile;
export const cp = actualFs.cp;
export const fchmod = actualFs.fchmod;
export const fchown = actualFs.fchown;
export const fdatasync = actualFs.fdatasync;
export const fstat = actualFs.fstat;
export const fsync = actualFs.fsync;
export const ftruncate = actualFs.ftruncate;
export const futimes = actualFs.futimes;
export const lchmod = actualFs.lchmod;
export const lchown = actualFs.lchown;
export const link = actualFs.link;
export const lstat = actualFs.lstat;
export const lutimes = actualFs.lutimes;
export const mkdir = actualFs.mkdir;
export const mkdtemp = actualFs.mkdtemp;
export const open = actualFs.open;
export const opendir = actualFs.opendir;
export const read = actualFs.read;
export const readdir = actualFs.readdir;
export const readFile = actualFs.readFile;
export const readlink = actualFs.readlink;
export const realpath = actualFs.realpath;
export const rename = actualFs.rename;
export const rm = actualFs.rm;
export const rmdir = actualFs.rmdir;
export const stat = actualFs.stat;
export const symlink = actualFs.symlink;
export const truncate = actualFs.truncate;
export const unlink = actualFs.unlink;
export const utimes = actualFs.utimes;
export const write = actualFs.write;
export const writev = actualFs.writev;
export const readv = actualFs.readv;

// Override existsSync with our mock
export default {
  ...actualFs,
  existsSync,
} as typeof actualFs;
