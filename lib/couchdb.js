var
  http = require('http'),
  fs = require('fs'),
  path = require('path'),
  querystring = require('querystring'),
  mime = require('./dep/mime'),
  base64 = require('./dep/base64');


function mixin() {
  // copy reference to target object
  var target = arguments[0] || {}, i = 1, length = arguments.length, deep = false, source;

  // Handle a deep copy situation
  if ( typeof target === "boolean" ) {
    deep = target;
    target = arguments[1] || {};
    // skip the boolean and the target
    i = 2;
  }

  // Handle case when target is a string or something (possible in deep copy)
  if ( typeof target !== "object" && !(typeof target === 'function') )
    target = {};

  // mixin process itself if only one argument is passed
  if ( length == i ) {
    target = GLOBAL;
    --i;
  }

  for ( ; i < length; i++ ) {
    // Only deal with non-null/undefined values
    if ( (source = arguments[i]) != null ) {
      // Extend the base object
      Object.getOwnPropertyNames(source).forEach(function(k){
        var d = Object.getOwnPropertyDescriptor(source, k) || {value: source[k]};
        if (d.get) {
          target.__defineGetter__(k, d.get);
          if (d.set) {
            target.__defineSetter__(k, d.set);
          }
        }
        else {
          // Prevent never-ending loop
          if (target === d.value) {
            return;
          }

          if (deep && d.value && typeof d.value === "object") {
            target[k] = mixin(deep,
              // Never move original objects, clone them
              source[k] || (d.value.length != null ? [] : {})
            , d.value);
          }
          else {
            target[k] = d.value;
          }
        }
      });
    }
  }
  // Return the modified object
  return target;
}

// Stringify function embedded inside of objects. Useful for couch views
exports.toJSON = function(data) {
  return JSON.stringify(data, function(key, val) {
    if (typeof val == 'function') {
      return val.toString();
    }
    return val;
  });
};

// Encode only key, startkey and endkey as JSON
exports.toQuery = function(query) {
  for (var k in query) {
    if (['key', 'startkey', 'endkey'].indexOf(k) != -1) {
      query[k] = JSON.stringify(query[k]);
    } else {
      query[k] = String(query[k]);
    }
  }
  return querystring.stringify(query);
};

// Helps turning a file into an inline CouchDB attachment
exports.toAttachment = function(file, cb) {
  fs.readFile(file, 'binary', function (er, data) {
    if (er) return cb && cb(er, data);
    var ext = path.extname(file).substr(1);
    cb && cb(null, {
      content_type: mime.lookup(ext),
      data: base64.encode(data)
    });
  })
};

exports.createClient = function(port, host, user, pass, maxListeners) {
  if (isNaN(port)) {
    host = port;
    port = 5984;
  }
  host = host || "localhost";

  var
    httpClient = http.createClient(port, host, port == 443),
    couchClient = new Client();
    
  if (typeof maxListeners !== "undefined"){
    httpClient.setMaxListeners(maxListeners);
  }

  couchClient.__defineGetter__('host', function() {
    return host;
  });

  couchClient.__defineGetter__('port', function() {
    return port;
  });

  couchClient._authorizationHeaders = function(headers) {
    if(user && pass) {
      headers.authorization = "Basic " + base64.encode(user + ":" + pass);
    }
    return headers;
  };

  couchClient._addClientListener = function() {
	  httpClient.addListener.apply(httpClient, arguments);
  };

  couchClient._queueRequest = function(options, cb) {
    couchClient._authorizationHeaders(options.headers);

    if (options.query) {
      options.path += '?'+exports.toQuery(options.query);
      delete options.query;
    }

    // CouchDB 1.0 requires application/json for _bulk_docs and other POST APIs.
    options.headers['Content-Type'] = options.headers['Content-Type'] || options.headers['content-Type'] || 'application/json';
    options.headers["Accept"] = options.headers["Accept"] || options.headers["accept"] || "application/json";

    var
      request = httpClient.request(
        options.method.toUpperCase(),
        options.path,
        options.headers
      ),
      cbFired = false,
      onError = function(reason) {
        if (!cbFired) cb && cb(new Error(reason));
      },
      onClose = function() {
        if (!cbFired) cb && cb();
      };
    
    request.addListener('error', onError);
    request.addListener('close', onClose);

    if (options.data && typeof options.data != 'string') {
      options.data = exports.toJSON(options.data);
    }

    if (options.data) {
      request.write(options.data, options.requestEncoding || 'utf8');
    }
    request.addListener("response", function(res) {
      var buffer = '';
      res.setEncoding(options.responseEncoding || 'utf8');
      res
        .addListener('data', function(chunk) {
          buffer += (chunk || '');
        })
        .addListener('end', function() {
          if(options.responseEncoding == 'binary') {
            cbFired = true;
            return cb && cb(null, buffer);
          }

          var json;
          try {
            json = JSON.parse(buffer);
          } catch (e) {
            cbFired = true;
            return cb && cb(new Error('invalid json: '+json+" "+e.message));
          }

          if (res.statusCode >= 400) {
            if (!('error' in json)) { json.error = 'httpstatuscode: '+ res.statusCode; }
            cbFired = true;
            return cb && cb(json);
          }

          if (!options.full) {
            cbFired = true;
            return cb && cb(null, json);
          }

          cbFired = true;
          cb && cb(null, {
            headers: res.headers,
            json: json,
          });
        });
      
    });
    request.end();
  };

  return couchClient;
};

var Client = exports.Client = function() {

}; 

function requestOptions (args) {
  var options;
  // might get between 0 and 3 strings,
  // and then a function
  var args = Array.prototype.slice.call(args, 0),
    cb = (typeof args[args.length-1] === "function") ? args.pop() : null;
  
  var method = args.shift(),
    path = args.shift(),
    data = args.shift();

  if (typeof method == 'object') {
    options = method;
  } else if (typeof method == 'string' && typeof path != 'string') {
    options = {
      path: method,
      query: path
    };
  } else {
    options = {
      method: method,
      path: path,
      data: data
    }
  }
  options.cb = cb;

  return options;
}

Client.prototype.addListener = function(type, fn) {
	if (type == 'error' || type == 'timeout') {
		this._addClientListener(type, fn);
	} else {
		throw new Error('CouchDB client does not support the ' + type + ' event.');
	}
}

Client.prototype.request = function(method, path, data, cb) {
  var
    defaults = {
      method: 'get',
      path: '/',
      headers: {},
      data: null,
      query: null,
      full: false
    },
    options = requestOptions(arguments);

  options = mixin(defaults, options);
  options.headers.host = options.headers.host || this.host;

  return this._queueRequest(options, options.cb);
};

Client.prototype.allDbs = function(cb) {
  return this.request({
    path: '/_all_dbs'
  }, cb);
};

Client.prototype.config = function(cb) {
  return this.request({
    path: '/_config'
  }, cb);
};

Client.prototype.uuids = function(count, cb) {
  if (!cb && typeof(count) === "function") {
    cb = count;
    count = "";
  }
  return this.request({
    path: '/_uuids'+(count ? '?count='+count : '')
  }, cb);
};

Client.prototype.replicate = function(source, target, options, cb) {
  if (!cb && typeof(options) === "function") {
    cb = options;
    options = {};
  }
  options = mixin({
    source: source,
    target: target,
  }, options || {});

  return this.request({
    method: 'POST',
    path: '/_replicate',
    data: options
  }, cb);
};

Client.prototype.stats = function() {
  var args = Array.prototype.slice.call(arguments),
    cb = (typeof args[args.length - 1] === "function") ? args.pop() : null;
  return this.request({
    path: '/_stats'+((args) ? '/'+args.join('/') : '')
  }, cb);
};

Client.prototype.activeTasks = function(cb) {
  return this.request({
    path: '/_active_tasks'
  }, cb);
};

Client.prototype.db = function(name) {
  var
    couchClient = this,
    couchDb = new Db();

  couchDb.__defineGetter__('name', function() {
    return name;
  });

  couchDb.__defineGetter__('client', function() {
    return couchClient;
  });

  couchDb.request = function(method, path, data, cb) {
    var options = requestOptions(arguments);
    options.path = '/'+name+(options.path || '');
    return couchClient.request(options, options.cb);
  };

  return couchDb;
};

var Db = exports.Db = function() {
  
}; 

function ensureDesignId(id) {
  if (!id || id.match(/^_design\//)) { return id; }
  return '_design/' + id;
}

Db.prototype.exists = function(cb) {
  this.request({path: ''}, function (er) {
    // if it was an error, then that's a "no" on the existing.
    cb && cb(null, !(er && er.error == 'not_found'));
  });
};

Db.prototype.info = function(cb) {
  return this.request({}, cb);
};

Db.prototype.create = function(cb) {
  return this.request({
    method: 'PUT'
  }, cb);
};

Db.prototype.remove = function(cb) {
  return this.request('DELETE', '', cb);
};

Db.prototype.getDoc = function(id, rev, cb) {
  var request = {
    path: '/'+id
  };
  if (!cb && typeof rev === 'function') {
    cb = rev;
  }
  else {
    request.query = {
      'rev': rev
    };
  }
  return this.request(request, cb);
};

Db.prototype.saveDoc = function(id, doc, cb) {
  if (typeof id == 'object') {
    cb = doc;
    return this.request({
      method: 'POST',
      path: '/',
      data: id,
    }, cb);
  }

  return this.request({
    method: 'PUT',
    path: '/'+id,
    data: doc,
  }, cb);
};

Db.prototype.removeDoc = function(id, rev, cb) {
  return this.request({
    method: 'DELETE',
    path: '/'+id,
    query: {"rev": rev}
  }, cb);
};

Db.prototype.copyDoc = function(srcId, destId, destRev, cb) {
  if (!cb && typeof(destRev) === "function") {
    cb = destRev;
    destRev = null;
  }
  if (destRev) {
    destId += '?rev='+destRev;
  }

  return this.request({
    method: 'COPY',
    path: '/'+srcId,
    headers: {
      'Destination': destId
    }
  }, cb);
}

Db.prototype.bulkDocs = function(data, cb) {
  if (!cb && typeof(data) === "function") {
    cb = data;
    data = null;
  }
  return this.request({
    method: 'POST',
    path: '/_bulk_docs',
    data: data,
  }, cb);
};

var util = require('util');

Db.prototype.saveDesign = function(design, doc, cb) {
  if (typeof design == 'object') {
    design._id = ensureDesignId(design._id);
    return this.saveDoc(design, doc, cb);
  }

  return this.saveDoc(ensureDesignId(design), doc, cb);
};

Db.prototype.saveAttachment = function(file, docId, options, cb) {
  var
    self = this,
    ext = path.extname(file).substr(1);
  
  if (!cb && typeof(options) === "function") {
    cb = options;
    options = {};
  }
  
  options = mixin({
    name: path.basename(file),
    contentType: mime.lookup(ext),
    rev: null
  }, options || {});

  // We could stream the file here, but I doubt people store big enough files
  // in couch to make this worth it?
  fs.readFile(file, 'binary', function (er, data) {
    if (er) return cb && cb(er);
    self.request({
      method: 'PUT',
      requestEncoding: 'binary',
      path: '/'+docId+'/'+options.name+(options.rev ? '?rev='+options.rev : ''),
      headers: {
        'Content-Type': options.contentType
      },
      data: data,
    }, cb);
  });
};

Db.prototype.removeAttachment = function(docId, attachmentId, docRev, cb) {
  return this.request({
    method: 'DELETE',
    path: '/'+docId+'/'+attachmentId,
    query: {rev: docRev}
  }, cb)
};

Db.prototype.getAttachment = function(docId, attachmentId, cb) {
  return this.request({
    path: '/'+docId+'/'+attachmentId,
    responseEncoding: 'binary',
  }, cb);
};

Db.prototype.allDocs = function(query, cb) {
  if (!cb && typeof(query) === "function") {
    cb = query;
    query = null;
  }
  return this.request({
    path: '/_all_docs',
    query: query
  }, cb);
};

Db.prototype.allDocsBySeq = function(query, cb) {
  if (!cb && typeof(query) === "function") {
    cb = query;
    query = null;
  }
  return this.request({
    path: '/_all_docs_by_seq',
    query: query
  }, cb);
};

Db.prototype.compact = function(design, cb) {
  if (!cb && typeof(design) === "function") {
    cb = design;
    design = null;
  }
  return this.request({
    method: 'POST',
    path: '/_compact'+(design ? '/'+design : ''),
  }, cb);
};

Db.prototype.tempView = function(data, query, cb) {
  return this.request({
    method: 'POST',
    path: '/_temp_view',
    data: data,
    query: query
  }, cb);
};

Db.prototype.viewCleanup = function(cb) {
  return this.request({
    method: 'POST',
    path: '/_view_cleanup',
  }, cb);
};

Db.prototype.view = function(design, view, query, cb) {
    if (typeof(query) === 'function' && !cb) {
        cb = query;
        query = undefined;
    }
    return this.request({
        path: ['', ensureDesignId(design), '_view', view].join('/'),
        query: query
    }, cb);
};

Db.prototype.list = function(design, list, view, query, cb) {
    if (typeof(query) === 'function' && !cb) {
        cb = query;
        query = undefined;
    }
    return this.request({
        path: ['', ensureDesignId(design), '_list', list, view].join('/'),
        query: query
    }, cb);
};

Db.prototype.update = function(design, update, docId, query, cb) {
    if (typeof(query) === 'function' && !cb) {
        cb = query;
        query = undefined;
    }
    if (typeof(docId) === 'function' && !cb && !query) {
        cb = docId;
        docId = undefined;
    }

    if (typeof(docId) === 'function' && !cb && !query && !docId) {
        cb = update;
        update = undefined;
    }

    var 
      updpath = ['',ensureDesignId(design), '_update', update].join('/'),
      updmethod = 'POST';

    if (docId) {
	  updpath = updpath + '/' + docId;
	  updmethod = 'PUT';
    }

    var updateOptions = {
        path: updpath,
        query: query,         // <-- arbitrary choice to use prop. 'query' (could have used data instead)
        method: updmethod     //     your handlers need to know the key-value pairs are in this property though
    };

    if (query && query.headers) {  // TBD: functional translation to commit-options etc. E.g. query.options { fullCommit,...}}
	   updateOptions.headers = query.headers;  
	   query.headers = undefined;
    }

    return this.request(updateOptions, cb);

};

Db.prototype.changes = function(query, cb) {
  return this.request({
    path: '/_changes',
    query: query
  }, cb);
};

Db.prototype.changesStream = function(query, options) {
  query = mixin({
    feed: "continuous",
    heartbeat: 1 * 1000
  }, query || {});

  options = mixin({
    timeout: 0,
  }, options);

  var
    stream = new process.EventEmitter(),
    client = http.createClient(this.client.port, this.client.host, this.client.port == 443),
    path = '/'+this.name+'/_changes?'+exports.toQuery(query),
    headers = this.client._authorizationHeaders({'Host': this.client.host}),
    request = client.request('GET', path, headers),
    buffer = '';

  request.setTimeout(options.timeout);
  request.addListener("response", function(res) {
    res.addListener('data', function(chunk) {
      buffer += (chunk || '');

      var offset, change;
      while ((offset = buffer.indexOf("\n")) >= 0) {
        change = buffer.substr(0, offset);
        buffer = buffer.substr(offset +1);

        // Couch sends an empty line as the "heartbeat"
        if (change == '') {
          return stream.emit('heartbeat');
        }

        try {
          change = JSON.parse(change);
        } catch (e) {
          return stream.emit('error', 'invalid json: '+change);
        }

        stream.emit('data', change);
      }
    })
    res.addListener('close', function(hadError) {
      stream.emit('end', hadError);
    });
  });
  request.end();

  stream.close = function() {
    return request.abort();
  };

  return stream;
};
