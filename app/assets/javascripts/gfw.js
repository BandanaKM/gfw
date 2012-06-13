function GFW() {
  var args = Array.prototype.slice.call(arguments),
  callback = args.pop(),
  modules = (args[0] && typeof args[0] === "string") ? args : args[0],
  config,
  i;

  if (!(this instanceof GFW)) {
    return new GFW(modules, callback);
  }

  if (!modules || modules === '*') {
    modules = [];
    for (i in GFW.modules) {
      if (GFW.modules.hasOwnProperty(i)) {
        modules.push(i);
      }
    }
  }

  for (i = 0; i < modules.length; i += 1) {
    GFW.modules[modules[i]](this);
  }

  callback(this);
  return this;
}

GFW.modules = {};

GFW.modules.app = function(gfw) {

  gfw.app = {};

  gfw.app.Instance = Class.extend({

    init: function(map, options) {
      this.options = _.defaults(options, {
        user       : 'gfw-01',
        layerTable : 'layerinfo'
      });

      this._precision = 2;
      this._layers = [];

      gfw.log.enabled = options ? options.logging: false;

      this._map = map;
      this._infowindow = new CartoDBInfowindow(map);

      this.queries = {};
      this.queries.forma  = "SELECT cartodb_id,alerts,z,the_geom_webmercator FROM gfw2_forma WHERE z=CASE WHEN 9 < {Z} THEN 17 ELSE {Z}+8 END";
      this.queries.hansen = "SELECT cartodb_id,alerts,z,the_geom_webmercator FROM gfw2_hansen WHERE z=CASE WHEN 9 < {Z} THEN 17 ELSE {Z}+8 END";
      this.queries.imazon_sad = "SELECT CASE WHEN {Z}<14 THEN st_buffer(the_geom_webmercator,(16-{Z})^4) ELSE the_geom_webmercator END the_geom_webmercator, stage, cartodb_id FROM gfw2_imazon WHERE year = 2012";

      this.lastHash = null;

      this._cartodb = Backbone.CartoDB({user: this.options.user});
      this.datalayers = new gfw.datalayers.Engine(this._cartodb, options.layerTable, this._map);

      this.mainLayer = null;
      this.currentBaseLayer = "forma";

      this._loadBaseLayer();
      this._setupZoom();

    },
    run: function() {
      this._setupListeners();
      this.update();
      gfw.log.info('App is now running!');
    },

    open: function() {
      var that = this;

      var
      dh = $(window).height(),
      hh = $("header").height();

      $("#map").animate({ height: dh - hh }, 250, function() {
        google.maps.event.trigger(that._map, "resize");
        that._map.setOptions({ scrollwheel: true });
        $("body").css({overflow:"hidden"});
      });

    },

    close: function(callback) {
      var that = this;

      $("#map").animate({height: 400 }, 250, function() {

        google.maps.event.trigger(that._map, "resize");
        that._map.setOptions({ scrollwheel: false });
        $("body").css({ overflow:"auto" });

        if (callback) {
          callback();
        }

      });

    },

    _setupZoom:function() {
      var overlayID =  document.getElementById("zoom_controls");
      // zoomIn
      var zoomInControlDiv = document.createElement('DIV');
      overlayID.appendChild(zoomInControlDiv);

      var zoomInControl = new this._zoomIn(zoomInControlDiv, map);
      zoomInControlDiv.index = 1;

      // zoomOut
      var zoomOutControlDiv = document.createElement('DIV');
      overlayID.appendChild(zoomOutControlDiv);

      var zoomOutControl = new this._zoomOut(zoomOutControlDiv, map);
      zoomOutControlDiv.index = 2;
    },

    _zoomIn: function(controlDiv, map) {
      controlDiv.setAttribute('class', 'zoom_in');

      google.maps.event.addDomListener(controlDiv, 'mousedown', function() {
        var zoom = map.getZoom() + 1;
        if (zoom < 20) {
          map.setZoom(zoom);
        }
      });
    },

    _zoomOut: function(controlDiv, map) {
      controlDiv.setAttribute('class', 'zoom_out');

      google.maps.event.addDomListener(controlDiv, 'mousedown', function() {
        var zoom = map.getZoom() - 1;

        if (zoom > 2) {
          map.setZoom(zoom);
        }

      });
    },

    _setupListeners: function(){
      var that = this;

      Legend.init();

      // Setup listeners
      google.maps.event.addListener(this._map, 'zoom_changed', function() {
        that._updateHash(that);
        that._refreshBaseLayer();
      });

      google.maps.event.addListener(this._map, 'dragend', function() {
        that._updateHash(that);
      });

      google.maps.event.addListenerOnce(this._map, 'tilesloaded', this._mapLoaded);

    },

    _removeLayer: function(name) {
      this._layers = _.without(this._layers, name);
      this._renderLayers();
    },

    _addLayer: function(name) {
      this._layers.push(name);
      this._renderLayers();
    },

    _renderLayers: function() {
      var that = this;

      if (this._layers.length > 0) {

        var template = "SELECT cartodb_id||':' ||'{{ table_name }}' as cartodb_id, the_geom_webmercator, '{{ table_name }}' AS name FROM {{ table_name }}";

        var queryArray = _.map(this._layers, function(layer) {
          return _.template(template, { table_name: layer });
        });

        var query = queryArray.join(" UNION ALL ");

        if (this.mainLayer) this.mainLayer.setMap(null);

        var layer = (this._layers.length > 1) ? "gfw2_layerstyles" : this._layers[0];

        this.mainLayer = new CartoDBLayer({
          map: map,
          user_name:'wri-01',
          table_name: layer,
          query: query,
          layer_order: "top",
          opacity: 1,
          interactivity:"cartodb_id",
          featureMouseClick: function(ev, latlng, data) {
            //we needed the cartodb_id and table name
            var pair = data.cartodb_id.split(':');
            //here i make a crude request for the columns of the table
            //nulling out the geoms to save payload
            var request_sql = "SELECT *, null as the_geom, null as the_geom_webmercator FROM " + pair[1] + " WHERE cartodb_id = " + pair[0];
            $.ajax({
                async: false,
                dataType: 'json',
                url: 'http://wri-01.cartodb.com/api/v2/sql?q=' + encodeURIComponent(request_sql) + '&callback=?',
                success: function(json) {
                    delete json.rows[0]['cartodb_id'],
                    delete json.rows[0]['the_geom'];
                    delete json.rows[0]['the_geom_webmercator'];
                    delete json.rows[0]['created_at'];
                    delete json.rows[0]['updated_at'];
                    var data = json.rows[0];
                    for (var key in data) {
                      var temp;
                      if (data.hasOwnProperty(key)) {
                        temp = data[key];
                        delete data[key];
                        key = key.replace(/_/g,' '); //add spaces to key names
                        data[key.charAt(0).toUpperCase() + key.substring(1)] = temp; //uppercase
                      }
                    }
                    that._infowindow.setContent(data);
                    that._infowindow.setPosition(latlng);
                    that._infowindow.open();
                }
            });
          },
          featureMouseOver: function(ev, latlng, data) {
            map.setOptions({draggableCursor: 'pointer'});
          },
          featureMouseOut: function() {
            map.setOptions({draggableCursor: 'default'});
          },
          debug:true,
          auto_bound: false
        });

        this.mainLayer.setInteraction(true);

      } else {
        this.mainLayer.setOpacity(0);
        this.mainLayer.setInteraction(false);
      }

    },

    _refreshBaseLayer: function() {
      var query = GFW.app.queries[GFW.app.currentBaseLayer].replace(/{Z}/g, GFW.app._map.getZoom());
      GFW.app.baseLayer.setQuery(query);
    },

    _updateBaseLayer: function() {
      var table_name = null;

      if (this.currentBaseLayer === "forma") {
        table_name = 'gfw2_forma';
      } else if (this.currentBaseLayer === "hansen") {
        table_name = 'gfw2_hansen';
      } else if (this.currentBaseLayer === "imazon_sad") {
        table_name = 'gfw2_imazon';
      }

      GFW.app.baseLayer.options.table_name = table_name;
      GFW.app.baseLayer.setQuery(GFW.app.queries[GFW.app.currentBaseLayer].replace(/{Z}/g, GFW.app._map.getZoom()));
    },

    _loadBaseLayer: function() {
      var table_name = null;

      if (this.currentBaseLayer === "forma") {
        table_name = 'gfw2_forma';
      } else if (this.currentBaseLayer === "hansen") {
        table_name = 'gfw2_hansen';
      } else if (this.currentBaseLayer === "imazon_sad") {
        table_name = 'gfw2_imazon';
      }

      this.baseLayer = new CartoDBLayer({
        map: map,
        user_name:'wri-01',
        table_name: table_name,
        query: this.queries[this.currentBaseLayer].replace(/{Z}/g, this._map.getZoom()),
        layer_order: "bottom",
        auto_bound: false
      });
    },

    _mapLoaded: function(){
      config.mapLoaded = true;

      Circle.init();
      Timeline.init();
      Filter.init();

      showMap ? Navigation.showState("map") : Navigation.showState("home");
    },

    _updateHash: function(self) {

      var
      zoom = self._map.getZoom(),
      lat  = self._map.getCenter().lat().toFixed(GFW.app._precision),
      lng  = self._map.getCenter().lng().toFixed(GFW.app._precision);
      hash = "/map/" + zoom + "/" + lat + "/" + lng;

      History.pushState({ state: 3 }, "Map", hash);
    },

    _parseHash: function(hash) {

      var args = hash.split("/");

      if (args.length >= 3) {

        var
        zoom = parseInt(args[2], 10),
        lat  = parseFloat(args[3]),
        lon  = parseFloat(args[4]);

        if (isNaN(zoom) || isNaN(lat) || isNaN(lon)) {
          return false;
        }

        return {
          center: new google.maps.LatLng(lat, lon),
          zoom: zoom
        };
      }

      return false;
    },

    update: function() {
      var hash = location.hash;

      if (hash === this.lastHash) {
        // console.info("(no change)");
        return;
      }

      var
        State  = History.getState(),
        parsed = this._parseHash(State.hash);

        if (parsed) {
        this._map.setZoom(parsed.zoom);
        this._map.setCenter(parsed.center);
        }

    }
  });
};

GFW.modules.maplayer = function(gfw) {
  gfw.maplayer = {};
  gfw.maplayer.Engine = Class.extend(
    {
    init: function(layer, map) {
      this.layer = layer;
      this._map = map;

      var sw = new google.maps.LatLng(this.layer.get('ymin'), this.layer.get('xmin'));
      var ne = new google.maps.LatLng(this.layer.get('ymax'),this.layer.get('xmax'));
      this._bounds = new google.maps.LatLngBounds(sw, ne);

      if (this.layer.get('title') != 'FORMA'){
        this.layer.attributes['visible'] = false;
      }

      this._addControl();
    },
    _addControl: function(){
      var that = this;

      var clickEvent = function() {
        that._toggleLayer(GFW.app);
      };

      var zoomEvent = function() {
        if (that.layer.attributes['visible']) {
          that._map.fitBounds(that._bounds);
        }
      };

      Filter.addFilter(this.layer.get('category_name'), this.layer.get('title'), clickEvent, zoomEvent);

    },
    _bindDisplay: function(display) {
      var that = this;
      display.setEngine(this);
    },

    _hideLayer: function(layer) {
      if (layer.get('visible') == false){
        gfw.log.info('LAYER OFF');
        this._map.overlayMapTypes.setAt(this._tileindex, null);
      }
    },

    _toggleLayer: function(that){

      this.layer.attributes['visible'] = !this.layer.attributes['visible'];

      var
      title      = this.layer.get('title'),
      id         = title.replace(/ /g, "_").toLowerCase(),
      visible    = this.layer.get('visible'),
      tableName  = this.layer.get('table_name'),
      category   = this.layer.get('category_name'),
      visibility = this.layer.get('visible');

      if (category === null || !category) {
        category = 'Other layers';
      }

      if (id === 'forma' && showMap && visible ) {
        Timeline.show();
      } else if ( (id === 'forma' && showMap && !visible) || (id === 'hansen' && showMap && visible) || (id === 'imazon_sad' && showMap && visible) ) {
        Timeline.hide();
      }

      var // special layers
      forma  = GFW.app.datalayers.LayersObj.get(569),
      hansen = GFW.app.datalayers.LayersObj.get(568),
      sad    = GFW.app.datalayers.LayersObj.get(567);

      if (category != 'Deforestation') {
        Legend.toggleItem(title, category, visible);
      }

      if (id === 'forma' || id === "hansen" || id === "imazon_sad") {

        GFW.app.currentBaseLayer = id;

        GFW.app._updateBaseLayer();

          if ( id == 'forma') {
            forma.attributes['visible']  = true;
          } else if (id == 'hansen') {
            hansen.attributes['visible']  = true;
          } else if (id == 'imazon_sad') {
            sad.attributes['visible']  = true;
          }

        if (id === "forma") {
          Legend.add(title, category);
          Legend.remove(sad.get("title"), category);
          Legend.remove(hansen.get("title"), category);
        }

      } else {

        if (visible) {
          GFW.app._addLayer(tableName);
        } else {
          GFW.app._removeLayer(tableName);
        }
    }

    }
  });

};

GFW.modules.datalayers = function(gfw) {
  gfw.datalayers = {};

  gfw.datalayers.Engine = Class.extend(
    {
    init: function(CartoDB, layerTable, map) {

      this._map         = map;
      this._bycartodbid = {};
      this._bytitle     = {};
      this._dataarray   = [];
      this._cartodb     = CartoDB;

      var LayersColl    = this._cartodb.CartoDBCollection.extend({
        sql: function(){
          return "SELECT cartodb_id AS id, title, table_name, category_name, zmin, zmax, ST_XMAX(the_geom) AS xmax, \
          ST_XMIN(the_geom) AS xmin, ST_YMAX(the_geom) AS ymax, ST_YMIN(the_geom) AS ymin, tileurl, true AS visible \
          FROM " + layerTable + " \
          WHERE display = TRUE ORDER BY displaylayer ASC";
        }
      });

      this.LayersObj = new LayersColl();
      this.LayersObj.fetch();
      this._loadLayers();
    },
    _loadLayers: function(){
      var that = this;

      this.LayersObj.bind('reset', function() {
        that.LayersObj.each(function(p) {
          that._addLayer(p);
        });
      });

    },
    _addLayer: function(p){
      var layer = new gfw.maplayer.Engine(p, this._map);
    }
  });
};

/**
 * Logging module that gfwtes log messages to the console and to the Speed
 * Tracer API. It contains convenience methods for info(), warn(), error(),
 * and todo().
 *
 */
GFW.modules.log = function(gfw) {
  gfw.log = {};

  gfw.log.info = function(msg) {
    gfw.log._gfwte('INFO: ' + msg);
  };

  gfw.log.warn = function(msg) {
    gfw.log._gfwte('WARN: ' + msg);
  };

  gfw.log.error = function(msg) {
    gfw.log._gfwte('ERROR: ' + msg);
  };

  gfw.log.todo = function(msg) {
    gfw.log._gfwte('TODO: '+ msg);
  };

  gfw.log._gfwte = function(msg) {
    var logger = window.console;
    if (gfw.log.enabled) {
      if (logger && logger.markTimeline) {
        logger.markTimeline(msg);
      }
      //console.log(msg);
    }
  };
};
