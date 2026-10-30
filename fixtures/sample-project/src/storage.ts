import localforage from 'localforage';
import { openDatabase } from 'sqlite3';

export const store = localforage;

export function openDb(name: string) {
  return openDatabase(name);
}
