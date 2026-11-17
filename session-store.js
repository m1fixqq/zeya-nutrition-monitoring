'use strict';

/**
 * Хранилище сессий в SQLite.
 *
 * Благодаря ему сессии не теряются при перезапуске сервера, в отличие
 * от стандартного MemoryStore из express-session.
 */

const session = require('express-session');
const { db } = require('./database');

const getStmt = db.prepare(
  'SELECT sess, expires FROM sessions WHERE sid = ?'
);
const setStmt = db.prepare(`
  INSERT INTO sessions (sid, sess, expires)
  VALUES (?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET
    sess = excluded.sess,
    expires = excluded.expires
`);
const destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
const touchStmt = db.prepare(
  'UPDATE sessions SET expires = ? WHERE sid = ?'
);
const clearStmt = db.prepare('DELETE FROM sessions');
const lengthStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM sessions WHERE expires > ?'
);
const allStmt = db.prepare(
  'SELECT sid, sess FROM sessions WHERE expires > ?'
);
const cleanupStmt = db.prepare(
  'DELETE FROM sessions WHERE expires < ?'
);

function expiresAt(sess) {
  if (sess && sess.cookie && sess.cookie.expires) {
    return new Date(sess.cookie.expires).getTime();
  }

  return Date.now() + 8 * 60 * 60 * 1000;
}

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    cleanupStmt.run(Date.now());
  }

  get(sid, callback) {
    try {
      const row = getStmt.get(sid);

      if (!row || row.expires <= Date.now()) {
        if (row) destroyStmt.run(sid);
        return callback(null, null);
      }

      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback) {
    try {
      setStmt.run(sid, JSON.stringify(sess), expiresAt(sess));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback) {
    try {
      destroyStmt.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback) {
    try {
      touchStmt.run(expiresAt(sess), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  clear(callback) {
    try {
      clearStmt.run();
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  length(callback) {
    try {
      callback(null, Number(lengthStmt.get(Date.now()).n));
    } catch (error) {
      callback(error);
    }
  }

  all(callback) {
    try {
      const sessions = allStmt.all(Date.now()).map((row) => ({
        sid: row.sid,
        sess: JSON.parse(row.sess),
      }));

      callback(null, sessions);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = { SqliteSessionStore };
