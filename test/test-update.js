require('./common');

var
DB_NAME = 'node-couchdb-test',
TEST_ID = 'my-doc',
TEST_ID2 = 'my-doc2',
TEST_DOC = {hello: 'world'},
createUpdate = function(rev) { return {_id: TEST_ID, _rev: rev, hello: 'universe'}; },


callbacks = {
  A: false,
  B: false,
  C: false,
  D: false,
  E: false,
  F: false,
  G: false,
  H: false,
  I: false,
  J: false,
  K: false,
  L: false,
  M: false,
  N: false,
  O: false,
  P: false,
  Q: false,
  R: false,
  S: false,
  T: false,
  U: false,
  V: false
},

  db = client.db(DB_NAME);

// Cleanup if test crashed in the middle
db.remove();

// Make sure our test db does not exist yet
db
  .exists(function(er, r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.A = true;
    assert.equal(false, r);
  });

// Now create it
db
  .create(function(er, r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.B = true;
  });

// Make sure that worked
db
  .exists(function(er, r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.C = true;
    assert.equal(true, r);
  });


// our design doc. Make sure that the returned req is JSON
var designDoc = {
  _id:"_design/designwithupdates",
  language: "javascript",
  updates: {
    "hello" : (function(doc, req) {
      if (!doc) {
        if (req.id) {
          return [
          { _id : req.id,
            reqs : [req] },
          JSON.stringify({'hresp':'New World'})];
        };
        return [null, JSON.stringify({'hresp':'No id given, could not create doc'})];
      };
      doc.world = 'hello';
      doc.reqs && doc.reqs.push(req);
      doc.edited_by = req.userCtx;
      return [doc, JSON.stringify({'hresp':'hello doc'})];
    }).toString(),
    "in-place" : (function(doc, req) {
      var field = req.query.field;
      var value = req.query.value;
      var message = "set "+field+" to "+value;
      doc[field] = value;
      return [doc, JSON.stringify({'hresp':message})];
    }).toString(),
    "bump-counter" : (function(doc, req) {
      if (!doc.counter) doc.counter = 0;
      doc.counter += 1;
      var message = "bumped it!";
      return [doc, JSON.stringify({'hresp':message})];
    }).toString(),
    "error" : (function(doc, req) {
      superFail.badCrash;
    }).toString(),
    "xml" : (function(doc, req) {
      var xml = new XML('<xml></xml>');
      xml.title = doc.title;
      var posted_xml = new XML(req.query.body);
      doc.via_xml = posted_xml.foo.toString();
      var resp =  {
        "headers" : {
          "Content-Type" : "application/xml"
        },
        "body" : xml.toXMLString()
      };
      
      return [doc, JSON.stringify(resp)];
     }).toString(),
     "get-uuid" : (function(doc, req) {
       return [null, JSON.stringify({"uuid":req.uuid})];
     }).toString(),
     "resp-code" : (function(doc,req) {
	   var dummy =  {"dummy": false};
       resp = { "code" : 437, "body": JSON.stringify(dummy)};
       return [null, resp];
     }).toString()
  }
};

db
  .saveDesign(designDoc, function(er,r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.D = true;
    assert.ok(r.ok);
  });

// NOTE: should wait until callbacks.D is true OR put the rest of the code in the above callback
var doc = {"word":"plankton", "name":"Rusty"};

db
  .saveDoc(doc, function(er,r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.E = true;
    assert.ok(r.ok);
    var docid =  r.id;

	// hello update world
	db.update("designwithupdates", "hello", docid, function(er,r){
		if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
	    callbacks.F = true;

		assert.equal(r.hresp,"hello doc");

		db.getDoc(docid,function(er, doc) {
			if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
		    callbacks.G = true;

			assert.equal(doc.world, "hello");
		});

	});

  });

// hello update world (no docid)
db.update("designwithupdates", "hello", function(er,r){
	if (er) throw new Error(JSON.stringify(er));
    callbacks.H = true;    

	assert.equal(r.hresp,"No id given, could not create doc");
});

db
  .saveDoc(doc, function(er,r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.I = true;
    assert.ok(r.ok);
    var docid =  r.id;

	// in place update 
	db.update("designwithupdates", "in-place", docid, { "field": "title", "value": "test" }, function(er,r){
		if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
	    callbacks.J = true;

		assert.equal(r.hresp,"set title to test");

		db.getDoc(docid,function(er, doc) {
			if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
		    callbacks.K = true;

			assert.equal(doc.title, "test");
		});

	});

  });


db
  .saveDoc(doc, function(er,r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.L = true;
    assert.ok(r.ok);
    var docid =  r.id;

	// bump counter
	db.update("designwithupdates", "bump-counter", docid, {"headers" : {"X-Couch-Full-Commit":"true"}}, function(er,r){
		if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
	    callbacks.M = true;

		assert.equal(r.hresp,"bumped it!");

		db.getDoc(docid,function(er, doc) {
			if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
		    callbacks.N = true;

			assert.equal(doc.counter, 1);


			// _update honors full commit if you need it to
			db.update("designwithupdates", "bump-counter", docid, {"headers" : {"X-Couch-Full-Commit":"true"}}, function(er,r){
				if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
			    callbacks.O = true;

				var currentRev = doc['_rev'];

				db.getDoc(docid,function(er, doc) {
					if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
				    callbacks.P = true;

					// not yet able to set full to access 
					// var NewRev = r.headers["X-Couch-Update-NewRev"];

					doc = db.getDoc(docid,function(er,doc){
						if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
					    callbacks.Q = true;

					    var firstRev = currentRev;
						// assert.equal(doc['_rev'], NewRev);
						assert.notEqual(doc['_rev'], firstRev);

						assert.equal(doc.counter, 2);
					});
				});

			});

		});

	});

  });


doc = {"title": "test", "word":"plankton", "name":"Rusty"};

db
  .saveDoc(doc, function(er,r) {
    if (er) throw new Error(JSON.stringify(er));
    callbacks.R = true;
    assert.ok(r.ok);
    var docid =  r.id;

	db.update("designwithupdates","xml", docid, {
	  "headers" : {"X-Couch-Full-Commit":"true"},
	  "body" : '<xml><foo>bar</foo></xml>'}, function(er,r){

		if (er) throw new Error(JSON.stringify(er));
	    callbacks.S = true;    

		assert.equal(r.body, "<xml>\n  <title>test</title>\n</xml>");

		db.getDoc(docid,function(er, doc) {
			if (er) throw new Error("docid: "+docid+":"+JSON.stringify(er));
		    callbacks.T = true;

			assert.equal(doc.via_xml, "bar");
		});
	
	});

});



// Server provides UUID when POSTing without an ID in the URL
db.update("designwithupdates", "get-uuid", function(er,r){
	if (er) throw new Error(JSON.stringify(er));
    callbacks.U = true;

    assert.equal(r.uuid.length, 32);  


});


// COUCHDB-648 - the code in the JSON response should be honored
db.update("designwithupdates", "resp-code", function(er,r){

	// we make the handler return 437 which triggers the error handling
    // so we can test it here:
	assert.notEqual(er,null); 
	// the handler has to return a json-ified status as well since couchdb lets us change the httpcode 
	// so it cannot know what it should be
	assert.equal(er.dummy, false); 
    callbacks.V = true;

});


process.addListener('exit', function() {
  checkCallbacks(callbacks);
});


