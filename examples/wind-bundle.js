/**
 * Wind map code (c) 2012
 * Fernanda Viegas & Martin Wattenberg
 */

 /**
 * Simple representation of 2D vector.
 */

var Vector = function(x, y) {
	this.x = x;
	this.y = y;
}


Vector.polar = function(r, theta) {
	return new Vector(r * Math.cos(theta), r * Math.sin(theta));
};


Vector.prototype.length = function() {
	return Math.sqrt(this.x * this.x + this.y * this.y);
};


Vector.prototype.copy = function(){
  return new Vector(this.x, this.y);
};


Vector.prototype.setLength = function(length) {
	var current = this.length();
	if (current) {
		var scale = length / current;
		this.x *= scale;
		this.y *= scale;
	}
	return this;
};


Vector.prototype.setAngle = function(theta) {
  var r = length();
  this.x = r * Math.cos(theta);
  this.y = r * Math.sin(theta);
  return this;
};


Vector.prototype.getAngle = function() {
  return Math.atan2(this.y, this.x);
};


Vector.prototype.d = function(v) {
		var dx = v.x - this.x;
		var dy = v.y - this.y;
		return Math.sqrt(dx * dx + dy * dy);
};/**
 * Identity projection.
 */
var IDProjection = {
	project: function(x, y, opt_v) {
		var v = opt_v || new Vector();
		v.x = x;
		v.y = y;
	  return v;
  },
	invert: function(x, y, opt_v) {
		var v = opt_v || new Vector();
		v.x = x;
		v.y = y;
	  return v;
  }
};

/**
 * Albers equal-area projection.
 * Constant param values after d3 (Bostock, Carden).
 */
var Albers = function() {
  function radians(degrees) {
		return Math.PI * degrees / 180;
  }

  var phi1 = radians(29.5);
  var phi2 = radians(45.5);
  var n = .5 * (phi1 + phi2);
	var C = Math.cos(phi1) * Math.cos(phi1) + 2 * n * Math.sin(phi1);
	var phi0 = radians(38);
	var lambda0 = radians(-98);
	var rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;

  return {
		project: function(lon, lat, opt_result) {
			lon = radians(lon);
		  lat = radians(lat);
		  var theta = n * (lon - lambda0);
		  var rho = Math.sqrt(C - 2 * n * Math.sin(lat)) / n;
		  var x = rho * Math.sin(theta);
		  var y = rho0 - rho * Math.cos(theta);
			if (opt_result) {
		    opt_result.x = x;
		    opt_result.y = y;
		    return opt_result;
	    }
		  return new Vector(x, y);
		},
		invert: function(x, y) {
			var rho2 = x * x + (rho0 - y) * (rho0 - y);
			var theta = Math.atan(x / (rho0 - y));
			var lon = lambda0 + theta / n;
			var lat = Math.asin((C / n - rho2 * n) / 2);
			return new Vector(lon * 180 / Math.PI, lat * 180 / Math.PI);
		}
	};
}();


var ScaledAlbers = function(scale, offsetX, offsetY, longMin, latMin) {
	this.scale = scale;
	this.offsetX = offsetX;
	this.offsetY = offsetY;
	this.longMin = longMin;
	this.latMin = latMin;
  this.swCorner = Albers.project(longMin, latMin);
};

ScaledAlbers.temp = new Vector(0, 0);

ScaledAlbers.prototype.project = function(lon, lat, opt_result) {
  var proj = Albers.project(lon, lat, ScaledAlbers.temp);
  var a = proj.x;
	var b = proj.y;
	var x = this.scale * (a - this.swCorner.x) + this.offsetX;
	var y = -this.scale * (b - this.swCorner.y) + this.offsetY;
	if (opt_result) {
		opt_result.x = x;
		opt_result.y = y;
		return opt_result;
	}
	return new Vector(x, y);
};

ScaledAlbers.prototype.invert = function(x, y) {
	var a = (x - this.offsetX) / this.scale + this.swCorner.x;
	var b = (y - this.offsetY) / -this.scale + this.swCorner.y;
	return Albers.invert(a, b);
};

/**
 * Represents a vector field based on an array of data,
 * with specified grid coordinates, using bilinear interpolation
 * for values that don't lie on grid points.
 */

/**
 * 
 * @param field 2D array of Vectors
 * 
 * next params are corners of region.
 * @param x0
 * @param y0
 * @param x1
 * @param y1
 */
var VectorField = function(field, x0, y0, x1, y1) {
	this.x0 = x0;
	this.x1 = x1;
	this.y0 = y0;
	this.y1 = y1;
	this.field = field;
	this.w = field.length;
	this.h = field[0].length;
	this.maxLength = 0;
	var mx = 0;
	var my = 0;
	for (var i = 0; i < this.w; i++) {
	  for (var j = 0; j < this.h; j++) {
			if (field[i][j].length() > this.maxLength) {
				mx = i;
				my = j;
			}
			this.maxLength = Math.max(this.maxLength, field[i][j].length());
		}
	}
	mx = (mx / this.w) * (x1 - x0) + x0;
	my = (my / this.h) * (y1 - y0) + y0;
};

/**
 * Reads data from raw object in form:
 * {
 *   x0: -126.292942,
 *   y0: 23.525552,
 *   x1: -66.922962,
 *   y1: 49.397231,
 *   gridWidth: 501.0,
 *   gridHeight: 219.0,
 *   field: [
 *     0,0,
 *     0,0,
 *     ... (list of vectors)
 *   ]
 * }
 *
 * If the correctForSphere flag is set, we correct for the
 * distortions introduced by an equirectangular projection.
 */
VectorField.read = function(data, correctForSphere) {
	var field = [];
	var w = data.gridWidth;
	var h = data.gridHeight;
	var n = 2 * w * h;
	var i = 0;
	// OK, "total" and "weight"
	// are kludges that you should totally ignore,
	// unless you are interested in the average
	// vector length on vector field over lat/lon domain.
	var total = 0;
	var weight = 0;
	for (var x = 0; x < w; x++) {
		field[x] = [];
		for (var y = 0; y < h; y++) {
			var vx = data.field[i++];
			var vy = data.field[i++];
			var v = new Vector(vx, vy);
			// Uncomment to test a constant field:
			// v = new Vector(10, 0);
			if (correctForSphere) {
				var ux = x / (w - 1);
				var uy = y / (h - 1);
				var lon = data.x0 * (1 - ux) + data.x1 * ux;
				var lat = data.y0 * (1 - uy) + data.y1 * uy;
				var m = Math.PI * lat / 180;
				var length = v.length();
				if (length) {
			    total += length * m;
			    weight += m;
		    }
				v.x /= Math.cos(m);
				v.setLength(length);
			}
			field[x][y] = v;
		}
	}
	var result = new VectorField(field, data.x0, data.y0, data.x1, data.y1);
  //window.console.log('total = ' + total);
	//window.console.log('weight = ' + weight);
  if (total && weight) {

	  result.averageLength = total / weight;
	}
	return result;
};
  
VectorField.prototype.inBounds = function(x, y) {
  return x >= this.x0 && x < this.x1 && y >= this.y0 && y < this.y1;
};


VectorField.prototype.bilinear = function(coord, a, b) {
  var na = Math.floor(a);
  var nb = Math.floor(b);
  var ma = Math.ceil(a);
  var mb = Math.ceil(b);
  var fa = a - na;
  var fb = b - nb;

  return this.field[na][nb][coord] * (1 - fa) * (1 - fb) +
  	     this.field[ma][nb][coord] * fa * (1 - fb) +
  	     this.field[na][mb][coord] * (1 - fa) * fb +
  	     this.field[ma][mb][coord] * fa * fb;
};


VectorField.prototype.getValue = function(x, y, opt_result) {
	var a = (this.w - 1 - 1e-6) * (x - this.x0) / (this.x1 - this.x0);
	var b = (this.h - 1 - 1e-6) * (y - this.y0) / (this.y1 - this.y0);
	var vx = this.bilinear('x', a, b);
	var vy = this.bilinear('y', a, b);
	if (opt_result) {
		opt_result.x = vx;
		opt_result.y = vy;
		return opt_result;
	}
	return new Vector(vx, vy);
};


VectorField.prototype.vectValue = function(vector) {
	return this.getValue(vector.x, vector.y);
};


VectorField.constant = function(dx, dy, x0, y0, x1, y1) {
	var field = new VectorField([[]], x0, y0, x1, y1);
	field.maxLength = Math.sqrt(dx * dx + dy * dy);
	field.getValue = function() {
		return new Vector(dx, dy);
	}
	return field;
}
/**
 * Listens to mouse events on an element, tracks zooming and panning,
 * informs other components of what's going on.
 */
var Animator = function(opt_animFunc) {
 	//this.element = element;
	this.mouseIsDown = false;
	this.mouseX = -1;
	this.mouseY = -1;
	this.animating = true;
	this.state = 'animate';
	this.listeners = [];
	this.dx = 0;
	this.dy = 0;
	this.scale = 1;
	this.zoomProgress = 0;
	this.scaleTarget = 1;
	this.scaleStart = 1;
	this.animFunc = opt_animFunc;
//	this.unzoomButton = opt_unzoomButton;

};
 

Animator.prototype.mousedown = function() {
	this.state = 'mouse-down';
	this.notify('startMove');
	this.landingX = this.mouseX;
	this.landingY = this.mouseY;
	this.dxStart = this.dx;
	this.dyStart = this.dy;
	this.scaleStart = this.scale;
	this.mouseIsDown = true;
};


Animator.prototype.mousemove = function() {
	if (!this.mouseIsDown) {
		this.notify('hover');
		return;
	}
	var ddx = this.mouseX - this.landingX;
	var ddy = this.mouseY - this.landingY;
	var slip = Math.abs(ddx) + Math.abs(ddy);
	if (slip > 2 || this.state == 'pan') {
		this.state = 'pan';
		this.dx += ddx;
		this.dy += ddy;
		this.landingX = this.mouseX;
		this.landingY = this.mouseY;
		this.notify('move');
	}
}

Animator.prototype.mouseup = function() {
	this.mouseIsDown = false;
	if (this.state == 'pan') {
		this.state = 'animate';
		this.notify('endMove');
		return;
	}
	this.zoomClick(this.mouseX, this.mouseY);
};

 
Animator.prototype.add = function(listener) {
 	this.listeners.push(listener);
};


Animator.prototype.notify = function(message) {
/*
	if (this.unzoomButton) {
		var diff = Math.abs(this.scale - 1) > .001 ||
		           Math.abs(this.dx) > .001 || Math.abs(this.dy > .001);
		this.unzoomButton.style.visibility = diff ? 'visible' : 'hidden';
	}
*/
	if (this.animFunc && !this.animFunc()) {
		return;
	}
	for (var i = 0; i < this.listeners.length; i++) {
		var listener = this.listeners[i];
		if (listener[message]) {
			listener[message].call(listener, this);
		}
	}
};


Animator.prototype.unzoom = function() {
	this.zoom(0, 0, 1);
};


Animator.prototype.zoomClick = function(x, y) {
	var z = 1.7;
	var scale = 1.7 * this.scale;
	var dx = x - z * (x - this.dx);
	var dy = y - z * (y - this.dy);
	this.zoom(dx, dy, scale);
};

Animator.prototype.zoom = function(dx, dy, scale) {
	this.state = 'zoom';
  this.zoomProgress = 0;
  this.scaleStart = this.scale;
	this.scaleTarget = scale;
	this.dxTarget = dx;
	this.dyTarget = dy;
	this.dxStart = this.dx;
	this.dyStart = this.dy;
	this.notify('startMove');
};

Animator.prototype.relativeZoom = function() {
	return this.scale / this.scaleStart;
};


Animator.prototype.relativeDx = function() {
	return this.dx - this.dxStart;
}

Animator.prototype.relativeDy = function() {
	return this.dy - this.dyStart;
}

Animator.prototype.start = function(opt_millis) {
	var millis = opt_millis || 20;
	var self = this;
	function go() {
		var start = new Date();
		self.loop();
		var time = new Date() - start;
		setTimeout(go, Math.max(10, millis - time));
	}
	go();
};


Animator.prototype.loop = function() {
	if (this.state == 'mouse-down' || this.state == 'pan') {
		return;
	}
	if (this.state == 'animate') {
  	this.notify('animate');
		return;
  }
	if (this.state == 'zoom') {
  	this.zoomProgress = Math.min(1, this.zoomProgress + .07);
	  var u = (1 + Math.cos(Math.PI * this.zoomProgress)) / 2;
		function lerp(a, b) {
			return u * a + (1 - u) * b;
		}
	  this.scale = lerp(this.scaleStart, this.scaleTarget);
		this.dx = lerp(this.dxStart, this.dxTarget);
		this.dy = lerp(this.dyStart, this.dyTarget);
  	if (this.zoomProgress < 1) {
  		this.notify('move');
  	} else {
  		this.state = 'animate';
  		this.zoomCurrent = this.zoomTarget;
   		this.notify('endMove');
  	}
  }
};
 
/**
 * Displays a geographic vector field using moving particles.
 * Positions in the field are drawn onscreen using the Alber
 * "Projection" file.
 */

var Particle = function(x, y, age) {
	this.x = x;
	this.y = y;
	this.oldX = -1;
	this.oldY = -1;
	this.age = age;
	this.rnd = Math.random();
}


/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale The scale factor for the projection.
 * @param {number} offsetX
 * @param {number} offsetY
 * @param {number} longMin
 * @param {number} latMin
 * @param {VectorField} field
 * @param {number} numParticles
 */
var MotionDisplay = function(canvas, field, numParticles, opt_projection) {
	this.canvas = canvas;
  this.projection = opt_projection || IDProjection;
  this.field = field;
	this.numParticles = numParticles;
	this.first = true;
	this.maxLength = field.maxLength;
	this.speedScale = 1;
	this.renderState = 'normal';
	//this.imageCanvas = imageCanvas;
	this.x0 = this.field.x0;
	this.x1 = this.field.x1;
	this.y0 = this.field.y0;
	this.y1 = this.field.y1;
	this.makeNewParticles(null, true);
	this.colors = [];
	this.rgb = '40, 40, 40';
	this.background = 'rgb(' + this.rgb + ')';
	this.backgroundAlpha = 'rgba(' + this.rgb + ', .02)';
	this.outsideColor = '#fff';
	for (var i = 0; i < 256; i++) {
		this.colors[i] = 'rgb(' + i + ',' + i + ',' + i + ')';
	}
	if (this.projection) {
  	this.startOffsetX = this.projection.offsetX;
  	this.startOffsetY = this.projection.offsetY;
  	this.startScale = this.projection.scale;
  }
};


MotionDisplay.prototype.setAlpha = function(alpha) {
	this.backgroundAlpha = 'rgba(' + this.rgb + ', ' + alpha + ')';
};

MotionDisplay.prototype.makeNewParticles = function(animator) {
	this.particles = [];
	for (var i = 0; i < this.numParticles; i++) {
		this.particles.push(this.makeParticle(animator));
	}
};


MotionDisplay.prototype.makeParticle = function(animator) {
	var dx = animator ? animator.dx : 0;
	var dy = animator ? animator.dy : 0;
	var scale = animator ? animator.scale : 1;
	var safecount = 0;
	for (;;) {
		var a = Math.random();
		var b = Math.random();
		var x = a * this.x0 + (1 - a) * this.x1;
		var y = b * this.y0 + (1 - b) * this.y1;
		var v = this.field.getValue(x, y);
		if (this.field.maxLength == 0) {
			return new Particle(x, y, 1 + 40 * Math.random());
		}
		var m = v.length() / this.field.maxLength;
		// The random factor here is designed to ensure that
		// more particles are placed in slower areas; this makes the
		// overall distribution appear more even.
		if ((v.x || v.y) && (++safecount > 10 || Math.random() > m * .9)) {
			var proj = this.projection.project(x, y);
			var sx = proj.x * scale + dx;
			var sy = proj.y * scale + dy;
			if (++safecount > 10 || !(sx < 0 || sy < 0 || sx > this.canvas.width || sy > this.canvas.height)) {
	      return new Particle(x, y, 1 + 40 * Math.random());
      }	
		}
	}
};

/*
MotionDisplay.prototype.startMove = function(animator) {
	// Save screen.
	this.imageCanvas.getContext('2d').drawImage(this.canvas, 0, 0);
};
*/

MotionDisplay.prototype.endMove  = function(animator) {
	if (animator.scale < 1.1) {
		this.x0 = this.field.x0;
		this.x1 = this.field.x1;
		this.y0 = this.field.y0;
		this.y1 = this.field.y1;
	} else {
		// get new bounds for making new particles.
		var p = this.projection;
		var self = this;
		function invert(x, y) {
			x = (x - animator.dx) / animator.scale;
			y = (y - animator.dy) / animator.scale;
			return self.projection.invert(x, y);
		}
		var loc = invert(0, 0);
		var x0 = loc.x;
		var x1 = loc.x;
		var y0 = loc.y;
		var y1 = loc.y;
		function expand(x, y) {
			var v = invert(x, y);
			x0 = Math.min(v.x, x0);
			x1 = Math.max(v.x, x1);
			y0 = Math.min(v.y, y0);
			y1 = Math.max(v.y, y1);
		}
		// This calculation with "top" is designed to fix a bug
		// where we were missing particles at the top of the
		// screen with north winds. This is a short-term fix,
		// it's dependent on the particular projection and
		// region, and we should figure out a more general
		// solution soon.
		var top = -.2 * this.canvas.height;
		expand(top, this.canvas.height);
		expand(this.canvas.width, top);
		expand(this.canvas.width, this.canvas.height);
		this.x0 = Math.max(this.field.x0, x0);
		this.x1 = Math.min(this.field.x1, x1);
		this.y0 = Math.max(this.field.y0, y0);
		this.y1 = Math.min(this.field.y1, y1);
	}
	tick = 0;
	this.makeNewParticles(animator);
};


MotionDisplay.prototype.animate = function(animator) {
	this.moveThings(animator);
  this.draw(animator);
}

/*
MotionDisplay.prototype.move = function(animator) {
	var w = this.canvas.width;
	var h = this.canvas.height;
	var g = this.canvas.getContext('2d');
	
	g.fillStyle = this.outsideColor;
	var dx = animator.dx;
	var dy = animator.dy;
	var scale = animator.scale;

	g.fillRect(0, 0, w, h);
	g.fillStyle = this.background;
  g.fillRect(dx, dy, w * scale, h * scale);
	var z = animator.relativeZoom();
	var dx = animator.dx - z * animator.dxStart;
	var dy = animator.dy - z * animator.dyStart;
	g.drawImage(this.imageCanvas, dx, dy, z * w, z * h);
};
*/

MotionDisplay.prototype.moveThings = function(animator) {
	var speed = .01 * this.speedScale / animator.scale;
	for (var i = 0; i < this.particles.length; i++) {
		var p = this.particles[i];
		if (p.age > 0 && this.field.inBounds(p.x, p.y)) {
		  var a = this.field.getValue(p.x, p.y);
			p.x += speed * a.x;
			p.y += speed * a.y;
			p.age--;
		} else {
			this.particles[i] = this.makeParticle(animator);
		}
	}
};


MotionDisplay.prototype.draw = function(animator) {
	var g = this.canvas.getContext('2d');
	var w = this.canvas.width;
	var h = this.canvas.height;
	if (this.first) {
		g.fillStyle =  this.background;
		this.first = false;
	} else {
		g.fillStyle = this.backgroundAlpha;
	}
	var dx = animator.dx;
	var dy = animator.dy;
	var scale = animator.scale;

	g.fillRect(dx, dy, w * scale,h * scale);
	var proj = new Vector(0, 0);
	var val = new Vector(0, 0);
	g.lineWidth = .75;
	for (var i = 0; i < this.particles.length; i++) {
		var p = this.particles[i];
		if (!this.field.inBounds(p.x, p.y)) {
			p.age = -2;
			continue;
		}
		this.projection.project(p.x, p.y, proj);
		proj.x = proj.x * scale + dx;
		proj.y = proj.y * scale + dy;
		if (proj.x < 0 || proj.y < 0 || proj.x > w || proj.y > h) {
			p.age = -2;
		}
		if (p.oldX != -1) {
			var wind = this.field.getValue(p.x, p.y, val);
			var s = wind.length() / this.maxLength;
			var c = 90 + Math.round(350 * s); // was 400
			if (c > 255) {
				c = 255;
			} 
			g.strokeStyle = this.colors[c];
			g.beginPath();
			g.moveTo(proj.x, proj.y);
			g.lineTo(p.oldX, p.oldY);
			g.stroke();
	  }
		p.oldX = proj.x;
		p.oldY = proj.y;
	}
};

  var field = VectorField.read(windData, true);

var mapAnimator;

function isAnimating() {
	return true;
	//return document.getElementById('animating').checked;
}

function doUnzoom() {
	mapAnimator.unzoom();
}

function format(x) {
	x = Math.round(x * 10) / 10;
	var a1 = ~~x;
	var a2 = (~~(x * 10)) % 10;
	return a1 + '.' + a2;	
}

function init() {
	loading = false;
	var timestamp = windData.timestamp || 'unknown on unknown';
	var parts = timestamp.split('on');
	var time = parts[0].trim();

	var canvas = document.getElementById('display');
	//var imageCanvas = document.getElementById('image-canvas');
	var mapProjection = new ScaledAlbers(
	    1111, -75, canvas.height - 100, -126.5, 23.5);
	var isMacFF = navigator.platform.indexOf('Mac') != -1 &&
	              navigator.userAgent.indexOf('Firefox') != -1;
	var isWinFF = navigator.platform.indexOf('Win') != -1 &&
	              navigator.userAgent.indexOf('Firefox') != -1;
	var isWinIE = navigator.platform.indexOf('Win') != -1 &&
	              navigator.userAgent.indexOf('MSIE') != -1;
	var numParticles = isMacFF || isWinIE ? 3500 : 5000; // slowwwww browsers
	var display = new MotionDisplay(canvas, field,
	                                numParticles, mapProjection);

  // IE & FF Windows do weird stuff with very low alpha.
  if (isWinFF || isWinIE) {
		display.setAlpha(.05);
	}

  // var navDiv = document.getElementById("city-display");
	// var unzoom = document.getElementById('unzoom');
	mapAnimator = new Animator(isAnimating);
	mapAnimator.add(display);

	mapAnimator.start(40);
}
