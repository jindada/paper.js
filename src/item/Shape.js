/*
 * Paper.js - The Swiss Army Knife of Vector Graphics Scripting.
 * http://paperjs.org/
 *
 * Copyright (c) 2011 - 2013, Juerg Lehni & Jonathan Puckey
 * http://lehni.org/ & http://jonathanpuckey.com/
 *
 * Distributed under the MIT license. See LICENSE file for details.
 *
 * All rights reserved.
 */

/**
 * @name Shape
 *
 * @class
 *
 * @extends Item
 */
var Shape = Item.extend(/** @lends Shape# */{
	_class: 'Shape',
	_transformContent: false,
	_boundsSelected: true,

	// TODO: SVG, serialization

	initialize: function Shape(type, point, size, radius, props) {
		this._type = type;
		this._size = size;
		this._radius = radius;
		this._initialize(props, point);
	},

	/**
	 * The size of the shape.
	 *
	 * @type Size
	 * @bean
	 */
	getSize: function() {
		var size = this._size;
		return new LinkedSize(size.width, size.height, this, 'setSize');
	},

	setSize: function(/* size */) {
		var type = this._type,
			size = Size.read(arguments);
		if (!this._size.equals(size)) {
			var width = size.width,
				height = size.height;
			if (type === 'circle') {
				// Use average of width and height as new size, then calculate
				// radius as a number from that:
				width = height = (width + height) / 2;
				this._radius = width / 2;
			} else if (type === 'ellipse') {
				// The radius is a size.
				this._radius.set(width / 2, height / 2);
			}
			this._size.set(width, height);
			this._changed(/*#=*/ Change.GEOMETRY);
		}
	},

	/**
	 * The radius of the shape, as a number if it is a circle, or a size object
	 * for ellipses and rounded rectangles.
	 *
	 * @type Number|Size
	 * @bean
	 */
	getRadius: function() {
		var rad = this._radius;
		return this._type === 'circle'
				? rad
				: new LinkedSize(rad.width, rad.height, this, 'setRadius');
	},

	setRadius: function(radius) {
		var type = this._type;
		if (type === 'circle') {
			if (radius === this._radius)
				return;
			var size = radius * 2;
			this._size.set(size, size);
		} else {
			radius = Size.read(arguments);
			if (this._radius.equals(radius))
				return;
			this._radius.set(radius.width, radius.height);
			if (type === 'ellipse')
				this._size.set(radius.width * 2, radius.height * 2);
		}
		this._changed(/*#=*/ Change.GEOMETRY);
	},

	isEmpty: function() {
		// A shape can never be "empty" in the sense that it does not hold a
		// definition. This is required for Group#bounds to work correctly when
		// containing a Shape.
		return false;
	},

	_draw: function(ctx, param) {
		var style = this._style,
			fillColor = style.getFillColor(),
			strokeColor = style.getStrokeColor();
		if (fillColor || strokeColor || param.clip) {
			var radius = this._radius,
				type = this._type;
			ctx.beginPath();
			if (type === 'circle') {
				ctx.arc(0, 0, radius, 0, Math.PI * 2, true);
			} else {
				var rx = radius.width,
					ry = radius.height,
					kappa = Numerical.KAPPA;
				if (type === 'ellipse') {
					// Use four bezier curves and KAPPA value to aproximate ellipse
					var	cx = rx * kappa,
						cy = ry * kappa;
					ctx.moveTo(-rx, 0);
					ctx.bezierCurveTo(-rx, -cy, -cx, -ry, 0, -ry);
					ctx.bezierCurveTo(cx, -ry, rx, -cy, rx, 0);
					ctx.bezierCurveTo(rx, cy, cx, ry, 0, ry);
					ctx.bezierCurveTo(-cx, ry, -rx, cy, -rx, 0);
				} else { // rect
					var size = this._size,
						width = size.width,
						height = size.height;
					if (rx === 0 && ry === 0) {
						// straight rect
						ctx.rect(-width / 2, -height / 2, width, height);
					} else {
						// rounded rect. Use inverse kappa to calculate position
						// of control points from the corners inwards.
						kappa = 1 - kappa;
						var x = width / 2,
							y = height / 2,
							cx = rx * kappa,
							cy = ry * kappa;
						ctx.moveTo(-x, -y + ry);
						ctx.bezierCurveTo(-x, -y + cy, -x + cx, -y, -x + rx, -y);
						ctx.lineTo(x - rx, -y);
						ctx.bezierCurveTo(x - cx, -y, x, -y + cy, x, -y + ry);
						ctx.lineTo(x, y - ry);
						ctx.bezierCurveTo(x, y - cy, x - cx, y, x - rx, y);
						ctx.lineTo(-x + rx, y);
						ctx.bezierCurveTo(-x + cx, y, -x, y - cy, -x, y - ry);
					}
				}
			}
		}
		if (!param.clip && (fillColor || strokeColor)) {
			this._setStyles(ctx);
			if (fillColor)
				ctx.fill();
			if (strokeColor)
				ctx.stroke();
		}
	},

	_canComposite: function() {
		// A path with only a fill  or a stroke can be directly blended, but if
		// it has both, it needs to be drawn into a separate canvas first.
		return !(this.hasFill() && this.hasStroke());
	},

	_getBounds: function(getter, matrix) {
		var rect = new Rectangle(this._size).setCenter(0, 0);
		if (getter !== 'getBounds' && this.hasStroke())
			rect = rect.expand(this.getStrokeWidth());
		return matrix ? matrix._transformBounds(rect) : rect;
	},

	_contains: function _contains(point) {
		switch (this._type) {
		case 'rect':
			return _contains.base.call(this, point);
		case 'circle':
		case 'ellipse':
			return point.divide(this._size).getLength() <= 0.5;
		}
	},

	_hitTest: function _hitTest(point) {
		if (this.hasStroke()) {
			var type = this._type,
				strokeWidth = this.getStrokeWidth();
			switch (type) {
			case 'rect':
				var rect = new Rectangle(this._size).setCenter(0, 0),
					outer = rect.expand(strokeWidth),
					inner = rect.expand(-strokeWidth);
				if (outer._containsPoint(point) && !inner._containsPoint(point))
					return new HitResult('stroke', this);
				break;
			case 'circle':
			case 'ellipse':
				var radius;
				if (type === 'ellipse') {
					// Calculate ellipse radius at angle
					var angle = point.getAngleInRadians(),
						size = this._size,
						width = size.width,
						height = size.height,
						x = width * Math.sin(angle),
						y = height * Math.cos(angle);
					radius = width * height / (2 * Math.sqrt(x * x + y * y));
				} else {
					radius = this._radius;
				}
				if (2 * Math.abs(point.getLength() - radius) <= strokeWidth)
					return new HitResult('stroke', this);
				break;
			}
		}
		return _hitTest.base.apply(this, arguments);
	},

	statics: new function() {
		function createShape(type, point, size, radius, args) {
			return new Shape(type, point, size, radius, Base.getNamed(args));
		}

		return /** @lends Shape */{
			/**
			 * Creates a circular Shape item.
			 *
			 * @param {Point} center the center point of the circle
			 * @param {Number} radius the radius of the circle
			 * @return {Shape} the newly created shape
			 *
			 * @example {@paperscript}
			 * var shape = new Shape.Circle(new Point(80, 50), 30);
			 * shape.strokeColor = 'black';
			 *
			 * @example {@paperscript} // Using object notation
			 * var shape = new Shape.Circle({
			 * 	center: [80, 50],
			 * 	radius: 30,
			 * 	strokeColor: 'black'
			 * });
			 */
			Circle: function(/* center, radius */) {
				var center = Point.readNamed(arguments, 'center'),
					radius = Base.readNamed(arguments, 'radius');
				return createShape('circle', center, new Size(radius * 2),
						radius, arguments);
			},

			/**
			 * Creates a rectangular Shape item from the passed point and size.
			 *
			 * @name Shape.Rectangle
			 * @param {Point} point
			 * @param {Size} size
			 * @return {Shape} the newly created shape
			 *
			 * @example {@paperscript}
			 * var point = new Point(20, 20);
			 * var size = new Size(60, 60);
			 * var shape = new Shape.Rectangle(point, size);
			 * shape.strokeColor = 'black';
			 *
			 * @example {@paperscript} // Using object notation
			 * var shape = new Shape.Rectangle({
			 * 	point: [20, 20],
			 * 	size: [60, 60],
			 * 	strokeColor: 'black'
			 * });
			 */
			/**
			 * Creates a rectanglular Shape item from the passed points. These
			 * do not necessarily need to be the top left and bottom right
			 * corners, the constructor figures out how to fit a rectangle
			 * between them.
			 *
			 * @name Shape.Rectangle
			 * @param {Point} from The first point defining the rectangle
			 * @param {Point} to The second point defining the rectangle
			 * @return {Shape} the newly created shape
			 *
			 * @example {@paperscript}
			 * var from = new Point(20, 20);
			 * var to = new Point(80, 80);
			 * var shape = new Shape.Rectangle(from, to);
			 * shape.strokeColor = 'black';
			 *
			 * @example {@paperscript} // Using object notation
			 * var shape = new Shape.Rectangle({
			 * 	from: [20, 20],
			 * 	to: [80, 80],
			 * 	strokeColor: 'black'
			 * });
			 */
			/**
			 * Creates a rectangular Shape item from the passed abstract
			 * {@link Rectangle}.
			 *
			 * @name Shape.Rectangle
			 * @param {Rectangle} rectangle
			 * @return {Shape} the newly created shape
			 *
			 * @example {@paperscript}
			 * var rectangle = new Rectangle({
			 * 	point: new Point(20, 20),
			 * 	size: new Size(60, 60)
			 * });
			 * var shape = new Shape.Rectangle(rectangle);
			 * shape.strokeColor = 'black';
			 *
			 * @example {@paperscript}
			 * var rectangle = new Rectangle({
			 * 	point: [20, 20],
			 * 	size: [60, 60]
			 * });
			 * 
			 * var shape = new Shape.Rectangle({
			 * 	rectangle: rectangle,
			 * 	strokeColor: 'black'
			 * });
			 */
			Rectangle: function(/* rectangle */) {
				var rect = Rectangle.readNamed(arguments, 'rectangle');
				return createShape('rect', rect.getCenter(true),
						rect.getSize(true), Size.readNamed(arguments, 'radius'),
						arguments);
			},

			/**
			 * Creates an elliptic Shape item.
			 *
			 * @param {Rectangle} rectangle
			 * @return {Shape} the newly created shape
			 *
			 * @example {@paperscript}
			 * var rectangle = new Rectangle({
			 * 	point: [20, 20],
			 * 	size: [180, 60]
			 * });
			 * var shape = new Shape.Ellipse(rectangle);
			 * shape.fillColor = 'black';
			 *
			 * @example {@paperscript} // Using object notation
			 * var shape = new Shape.Ellipse({
			 * 	point: [20, 20],
			 * 	size: [180, 60],
			 * 	fillColor: 'black'
			 * });
			 */
			Ellipse: function(/* rectangle */) {
				var rect = Rectangle.readNamed(arguments, 'rectangle'),
					size = rect.getSize(true);
				return createShape('ellipse', rect.getCenter(true), size,
						new Size(size.width / 2, size.height / 2), arguments);
			}
		};
	}
});
