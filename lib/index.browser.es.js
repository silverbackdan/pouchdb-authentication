import urlJoin from 'url-join';
import urlParse from 'url-parse';
import inherits from 'inherits';
import { btoa } from 'pouchdb-binary-utils';
import ajaxCore from 'pouchdb-ajax';
import { assign, toPromise, clone } from 'pouchdb-utils';
import Promise from 'pouchdb-promise';

function getBaseUrl(db) {
  // Parse database url
  var url;
  if (typeof db.getUrl === 'function') { // pouchdb pre-6.0.0
    url = urlParse(db.getUrl());
  } else { // pouchdb post-6.0.0
    // Use PouchDB.defaults' prefix, if any
    var prefix = db.__opts && db.__opts.prefix ? db.__opts.prefix + '/' : '';
    url = urlParse(prefix + db.name);
  }

  // Compute parent path for databases not hosted on domain root (see #215)
  var path = url.pathname;
  path = path.substr(-1, 1) === '/' ? path.substr(0, -1) : path;
  var parentPath = path.split('/').slice(0, -1).join('/');

  return url.origin + parentPath;
}

function getConfigUrl(db, nodeName) {
  return urlJoin(getBaseUrl(db), (nodeName ? '/_node/' + nodeName : '') + '/_config');
}

function getUsersUrl(db) {
  return urlJoin(getBaseUrl(db), '/_users');
}

function getSessionUrl(db) {
  return urlJoin(getBaseUrl(db), '/_session');
}

function getBasicAuthHeaders(db) {
  var auth;

  if (db.__opts.auth) {
    auth = db.__opts.auth;
  } else {
    var url = urlParse(db.name);
    if (url.auth) {
      auth = url;
    }
  }

  if (!auth) {
    return {};
  }

  var str = auth.username + ':' + auth.password;
  var token = btoa(unescape(encodeURIComponent(str)));
  return {Authorization: 'Basic ' + token};
}

function wrapError(callback) {
  // provide more helpful error message
  return function (err, res) {
    if (err) {
      if (err.name === 'unknown_error') {
        err.message = (err.message || '') +
            ' Unknown error!  Did you remember to enable CORS?';
      }
    }
    return callback(err, res);
  };
}

function AuthError(message) {
  this.status = 400;
  this.name = 'authentication_error';
  this.message = message;
  this.error = true;
  try {
    Error.captureStackTrace(this, AuthError);
  } catch (e) {}
}

inherits(AuthError, Error);

var getMembership = toPromise(function (opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = opts;
    opts = {};
  }

  var url = getBaseUrl(db) + '/_membership';
  var ajaxOpts = assign({
    method: 'GET',
    url: url,
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  ajaxCore(ajaxOpts, wrapError(callback));
});

var signUpAdmin = toPromise(function (username, password, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = typeof opts === 'undefined' ? (typeof password === 'undefined' ?
      username : password) : opts;
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return callback(new AuthError('You must provide a username'));
  } else if (!password) {
    return callback(new AuthError('You must provide a password'));
  }

  db.getMembership(opts, function (error, membership) {
    var nodeName;
    if (error) {
      if (error.error !== 'illegal_database_name') {
        return callback(error);
      } else {
        // Some couchdb-1.x-like server
        nodeName = undefined;
      }
    } else {
      // Some couchdb-2.x-like server
      nodeName = membership.all_nodes[0];
    }

    var configUrl = getConfigUrl(db, nodeName);
    var url = (opts.configUrl || configUrl) + '/admins/' + encodeURIComponent(username);
    var ajaxOpts = assign({
      method: 'PUT',
      url: url,
      processData: false,
      headers: getBasicAuthHeaders(db),
      body: '"' + password + '"',
    }, opts.ajax || {});
    ajaxCore(ajaxOpts, wrapError(callback));
  });
});

var deleteAdmin = toPromise(function (username, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = typeof opts === 'undefined' ? username : opts;
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return callback(new AuthError('You must provide a username'));
  }

  db.getMembership(opts, function (error, membership) {
    var nodeName;
    if (error) {
      if (error.error !== 'illegal_database_name') {
        return callback(error);
      } else {
        // Some couchdb-1.x-like server
        nodeName = undefined;
      }
    } else {
      // Some couchdb-2.x-like server
      nodeName = membership.all_nodes[0];
    }

    var configUrl = getConfigUrl(db, nodeName);
    var url = (opts.configUrl || configUrl) + '/admins/' + encodeURIComponent(username);
    var ajaxOpts = assign({
      method: 'DELETE',
      url: url,
      processData: false,
      headers: getBasicAuthHeaders(db),
    }, opts.ajax || {});
    ajaxCore(ajaxOpts, wrapError(callback));
  });
});

var logIn = toPromise(function (username, password, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = opts;
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('this plugin only works for the http/https adapter'));
  }

  if (!username) {
    return callback(new AuthError('you must provide a username'));
  } else if (!password) {
    return callback(new AuthError('you must provide a password'));
  }

  var ajaxOpts = assign({
    method: 'POST',
    url: getSessionUrl(db),
    headers: assign({'Content-Type': 'application/json'}, getBasicAuthHeaders(db)),
    body: {name: username, password: password},
  }, opts.ajax || {});
  ajaxCore(ajaxOpts, wrapError(callback));
});

var logOut = toPromise(function (opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = opts;
    opts = {};
  }
  var ajaxOpts = assign({
    method: 'DELETE',
    url: getSessionUrl(db),
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  ajaxCore(ajaxOpts, wrapError(callback));
});

var getSession = toPromise(function (opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = opts;
    opts = {};
  }
  var url = getSessionUrl(db);

  var ajaxOpts = assign({
    method: 'GET',
    url: url,
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  ajaxCore(ajaxOpts, wrapError(callback));
});

var getUsersDatabaseUrl = function () {
  var db = this;
  return getUsersUrl(db);
};

function updateUser(db, user, opts, callback) {
  var reservedWords = [
    '_id',
    '_rev',
    'name',
    'type',
    'roles',
    'password',
    'password_scheme',
    'iterations',
    'derived_key',
    'salt' ];

  if (opts.metadata) {
    for (var key in opts.metadata) {
      if (opts.metadata.hasOwnProperty(key) && reservedWords.indexOf(key) !== -1) {
        return callback(new AuthError('cannot use reserved word in metadata: "' + key + '"'));
      }
    }
    user = assign(user, opts.metadata);
  }

  if (opts.roles) {
    user = assign(user, {roles: opts.roles});
  }

  var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id);
  var ajaxOpts = assign({
    method: 'PUT',
    url: url,
    body: user,
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  ajaxCore(ajaxOpts, wrapError(callback));
}

var signUp = toPromise(function (username, password, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = typeof opts === 'undefined' ? (typeof password === 'undefined' ?
      username : password) : opts;
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return callback(new AuthError('You must provide a username'));
  } else if (!password) {
    return callback(new AuthError('You must provide a password'));
  }

  var userId = 'org.couchdb.user:' + username;
  var user = {
    name: username,
    password: password,
    roles: [],
    type: 'user',
    _id: userId,
  };

  updateUser(db, user, opts, callback);
});

var getUser = toPromise(function (username, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = typeof opts === 'undefined' ? username : opts;
    opts = {};
  }
  if (!username) {
    return callback(new AuthError('you must provide a username'));
  }

  var url = getUsersUrl(db);
  var ajaxOpts = assign({
    method: 'GET',
    url: url + '/' + encodeURIComponent('org.couchdb.user:' + username),
    headers: getBasicAuthHeaders(db),
  }, opts.ajax || {});
  ajaxCore(ajaxOpts, wrapError(callback));
});

var putUser = toPromise(function (username, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = typeof opts === 'undefined' ? username : opts;
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return callback(new AuthError('You must provide a username'));
  }

  db.getUser(username, opts, function (error, user) {
    if (error) {
      return callback(error);
    }

    updateUser(db, user, opts, callback);
  });
});

var deleteUser = toPromise(function (username, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = typeof opts === 'undefined' ? username : opts;
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return callback(new AuthError('You must provide a username'));
  }

  db.getUser(username, opts, function (error, user) {
    if (error) {
      return callback(error);
    }

    var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id) + '?rev=' + user._rev;
    var ajaxOpts = assign({
      method: 'DELETE',
      url: url,
      headers: getBasicAuthHeaders(db),
    }, opts.ajax || {});
    ajaxCore(ajaxOpts, wrapError(callback));
  });
});

var changePassword = toPromise(function (username, password, opts, callback) {
  var db = this;
  if (typeof callback === 'undefined') {
    callback = typeof opts === 'undefined' ? (typeof password === 'undefined' ?
      username : password) : opts;
    opts = {};
  }
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  } else if (!username) {
    return callback(new AuthError('You must provide a username'));
  } else if (!password) {
    return callback(new AuthError('You must provide a password'));
  }

  db.getUser(username, opts, function (error, user) {
    if (error) {
      return callback(error);
    }

    user.password = password;

    var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id);
    var ajaxOpts = assign({
      method: 'PUT',
      url: url,
      headers: getBasicAuthHeaders(db),
      body: user,
    }, opts.ajax || {});
    ajaxCore(ajaxOpts, wrapError(callback));
  });
});

var changeUsername = toPromise(function (oldUsername, newUsername, opts, callback) {
  var db = this;
  var USERNAME_PREFIX = 'org.couchdb.user:';
  var ajax = function (opts) {
    return new Promise(function (resolve, reject) {
      ajaxCore(opts, wrapError(function (err, res) {
        if (err) {
          return reject(err);
        }
        resolve(res);
      }));
    });
  };
  var updateUser = function (user, opts) {
    var url = getUsersUrl(db) + '/' + encodeURIComponent(user._id);
    var updateOpts = assign({
      method: 'PUT',
      url: url,
      headers: getBasicAuthHeaders(db),
      body: user,
    }, opts.ajax);
    return ajax(updateOpts);
  };
  if (typeof callback === 'undefined') {
    callback = opts;
    opts = {};
  }
  opts.ajax = opts.ajax || {};
  if (['http', 'https'].indexOf(db.type()) === -1) {
    return callback(new AuthError('This plugin only works for the http/https adapter. ' +
      'So you should use new PouchDB("http://mysite.com:5984/mydb") instead.'));
  }
  if (!newUsername) {
    return callback(new AuthError('You must provide a new username'));
  }
  if (!oldUsername) {
    return callback(new AuthError('You must provide a username to rename'));
  }

  db.getUser(newUsername, opts)
  .then(function () {
    var error = new AuthError('user already exists');
    error.taken = true;
    throw error;
  }, function () {
    return db.getUser(oldUsername, opts);
  })
  .then(function (user) {
    var newUser = clone(user);
    delete newUser._rev;
    newUser._id = USERNAME_PREFIX + newUsername;
    newUser.name = newUsername;
    newUser.roles = opts.roles || user.roles || {};
    return updateUser(newUser, opts).then(function () {
      user._deleted = true;
      return updateUser(user, opts);
    });
  }).then(function (res) {
    callback(null, res);
  }).catch(callback);
});

var plugin = {};

plugin.login = logIn;
plugin.logIn = logIn;
plugin.logout = logOut;
plugin.logOut = logOut;
plugin.getSession = getSession;

plugin.getMembership = getMembership;
plugin.signUpAdmin = signUpAdmin;
plugin.deleteAdmin = deleteAdmin;

plugin.getUsersDatabaseUrl = getUsersDatabaseUrl;
plugin.signup = signUp;
plugin.signUp = signUp;
plugin.getUser = getUser;
plugin.putUser = putUser;
plugin.deleteUser = deleteUser;
plugin.changePassword = changePassword;
plugin.changeUsername = changeUsername;

if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(plugin);
}

export default plugin;
