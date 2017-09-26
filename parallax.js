var parallax_components = [];

$(document).ready(function() {
	parallax_components = $('body').find('.parallax-component');
  	let parallax_containers = $(document).find('.parallax-container');
  	$.each(parallax_containers, function() {
		updateContainerHeight(this);
  	});
});

$(window).on('scroll', function() {
   window.requestAnimationFrame(updateParallaxOffset);
});

$(window).on('resize', function() {
  window.requestAnimationFrame(function() {
  	let parallax_containers = $(document).find('.parallax-container');
  	$.each(parallax_containers, function() {
		updateContainerHeight(this);
  	});
  });
});



function updateParallaxOffset() {
	let offset = window.pageYOffset //	Get offset from top of parallax container, not entire page.

	for(let i = 0; i < parallax_components.length; i++) {
		let container = $(parallax_components[i]).parents('.parallax-container')[0];
		let offset = container.getBoundingClientRect().top * (-1);

		if(isInViewport(container)) {
			let depth = parallax_components[i].getAttribute('data-depth');
			let y_offset = offset * depth;

			$(parallax_components[i]).css('transform', `translate(-50%, ${y_offset}px)`);
		}
	}
}



//	Update header height to the background parallax layer's height
function updateContainerHeight(elem) {
	//	Get width and height from data-ids
	let w = $(elem).attr('data-width');
	let h = $(elem).attr('data-height');
	//	Default dimensions to something if not specified
	let aspect_x = w || 2560;
	let aspect_y = h || 1440;
	let ratio = aspect_y / aspect_x;

	//	Header height = viewport width * ratio.
	let height = Math.ceil($(window).width() * ratio);
	$(elem).height(height + "px");
}



function isInViewport(el) {
    if (typeof jQuery === "function" && el instanceof jQuery) {
        el = el[0];
    }

    //	Get element's dimensions.
    var rect = el.getBoundingClientRect();

   	let viewport_top = 0;
   	let viewport_bot = viewport_top + $(window).height();

   	//	Get height of viewport and parallax container.
   	let viewport_height = viewport_bot - viewport_top;
   	let rect_height = rect.bottom - rect.top;

   	//	Declare some booleans.
   	let top_inside, bot_inside;

   	//	Viewport is smaller than parallax container.
   	if(viewport_height <= rect_height) {
   		//	Check if viewport edges are inside parallax container.
	   	top_inside = rect.top <= viewport_top && viewport_top <= rect.bottom;
	   	bot_inside = rect.top <= viewport_bot && viewport_bot <= rect.bottom;

	   	return (top_inside || bot_inside);
	}

	//	Parallax container is smaller than viewport.
	else {
		//	Check if parallax container edges are inside viewport.
	   	top_inside = viewport_top < rect.top && rect.top < viewport_bot;
	   	bot_inside = viewport_top < rect.bottom && rect.bottom < viewport_bot;

	   	return (top_inside || bot_inside);
	}
}