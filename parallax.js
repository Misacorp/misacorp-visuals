var elements = [];

$('#background').ready(function() {
	updateHeaderHeight();
});

$(document).ready(function() {
	elements = $('body').find('.parallax-component');
});

// window.addEventListener(
//   'scroll',
//   (event) => requestAnimationFrame(() => updateParallaxOffset(window.pageYOffset))
// );

// window.addEventListener(
//   'resize',
//   (event) => requestAnimationFrame(() => updateHeaderHeight())
// );

$(window).on('scroll', function() {
   window.requestAnimationFrame(updateParallaxOffset);
});

$(window).on('resize', function() {
   window.requestAnimationFrame(updateHeaderHeight);
});

//	Change landscape SVG objects to PNG when scrolling.

// $(document).on('scrollstart', function() {
// 	console.log("Scroll start");
// 	$('#background').attr('src','img/header/png/00-background.png');		//	Stutters
// });

// $(document).on('scrollstop', function() {
// 	console.log("Scroll end");
// 	$('#background').attr('src','img/header/00-background.svg');			//	Stutters
// });



function updateParallaxOffset() {
	let offset = window.pageYOffset

	//	Degub array for in / out of viewport
	var in_or_out = [];
	var debug_string = "";

	for(let i = 0; i < elements.length; i++) {
		let container = $(elements[i]).parents('.parallax-container')[0];

		if(isInViewport(container)) {
			in_or_out[i] = "IN";

			let depth = elements[i].getAttribute('data-depth');
			let y_offset = offset * depth;

			// if(elements[i].getAttribute('id') == 'trees-front') {
			// 	y_offset = y_offset + 5;
			// }
			$(elements[i]).css('transform', `translate(-50%, ${y_offset}px)`);
			$(elements[i]).css('background-color', 'rgba(0,255,0,0.2)');
			$(elements[i]).css('border', '5px solid black');
		}
		else {
			in_or_out[i] = "OUT";
			$(elements[i]).css('background-color', 'rgba(255,0,0,0.2)');
		}
	}

	for(let i = 0; i < in_or_out.length - 1; i++) {
		debug_string = debug_string + in_or_out[i] + ", ";
	}
	debug_string = debug_string + in_or_out[in_or_out.length - 1];
	console.log(debug_string);
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



function isInViewport(el) {
//	Source: https://stackoverflow.com/questions/123999/how-to-tell-if-a-dom-element-is-visible-in-the-current-viewport

    //	Special bonus for those using jQuery
    if (typeof jQuery === "function" && el instanceof jQuery) {
        el = el[0];
    }

    var rect = el.getBoundingClientRect();

   	//	If viewport top or bottom is inside rect, return true  ---- Only works if rect is larger than viewport!
   	let viewport_top = 0;
   	let viewport_bot = viewport_top + $(window).height();

   	let viewport_height = viewport_bot - viewport_top;
   	let rect_height = rect.bottom - rect.top;

   	let top_inside, bot_inside;

   	//	Viewport is smaller than parallax container.
   	if(viewport_height <= rect_height) {
	   	top_inside = rect.top <= viewport_top && viewport_top <= rect.bottom;
	   	bot_inside = rect.top <= viewport_bot && viewport_bot <= rect.bottom;

	   	if(!top_inside) {
	   		console.log("Top out of bounds: " + rect.top + " <= " + viewport_top + " <= " + rect.bottom);
	   	}
	   	if(!bot_inside) {
	   		console.log("Bot out of bounds: " + rect.top + " <= " + viewport_bot + " <= " + rect.bottom);
	   	}

	   	return (top_inside || bot_inside);
	}
	
	//	Parallax container is smaller than viewport.
	else {
	   	top_inside = viewport_top < rect.top && rect.top < viewport_bot;
	   	bot_inside = viewport_top < rect.bottom && rect.bottom < viewport_bot;

	   	if(!top_inside) {
	   		console.log("Parallax < viewport. Top out of bounds: " + viewport_top + " < " + rect.top + " < " + viewport_bot);
	   	}
	   	if(!bot_inside) {
	   		console.log("Parallax < viewport. Bot out of bounds: " + viewport_top + " < " + rect.bottom + " < " + viewport_bot);
	   	}
	   	console.log(top_inside || bot_inside);
	   	return (top_inside || bot_inside);
	}


}