let elements = [];

// window.addEventListener(
//   'scroll',
//   (event) => requestAnimationFrame(() => updateParallaxOffset(window.pageYOffset))
// );

// window.addEventListener(
//   'resize',
//   (event) => requestAnimationFrame(() => updateHeaderHeight())
// );

window.onload = function() {
	svgObject = document.getElementById('mountainscape').contentDocument;
	svg_objects = $(svgObject).find('.parallax-component');
	header_objects = $('header').find('.parallax-component');
	elements = concat_collection(svg_objects, header_objects);
	updateHeaderHeight();
	sortZIndexByDepth(elements);
};


$(window).on('scroll', function() {
   	window.requestAnimationFrame(updateParallaxOffset);
});


$(window).on('resize', function() {
   window.requestAnimationFrame(updateHeaderHeight);
});


function updateParallaxOffset() {
	let offset = window.pageYOffset

	for(let i = 0; i < elements.length; i++) {
		let depth = elements[i].getAttribute('data-depth');
		let y_offset = offset * depth;

		if(elements[i].getAttribute('id') == 'trees-front') {
			y_offset = y_offset + 5;
		}
		$(elements[i]).css('transform', `translateY(${y_offset}px)`);
	}
}

//	Update header height to the background parallax layer's height
function updateHeaderHeight() {
	//	Constants defined by image proportions
	let aspect_x = 2560;
	let aspect_y = 1440;
	let ratio = aspect_y / aspect_x;

	//	Header height = viewport width * ratio.
	let height = Math.ceil($(window).width() * ratio);
	$('header').height(height + "px");
};

function concat_collection(obj1, obj2) {
    var i;
    var arr  = new Array();
    var len1 = obj1.length;
    var len2 = obj2.length;
    for (i=0; i<len1; i++) {
        arr.push(obj1[i]);
    }
    for (i=0; i<len2; i++) {
        arr.push(obj2[i]);
    }
    return arr;
}

function sortZIndexByDepth(elements) {
	for(let i = 0; i < elements.length; i++) {
		console.log($(elements[i]).attr('data-depth'));
	}
}