let elements = $('body').find('.parallax-component');

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

	for(let i = 0; i < elements.length; i++) {
		let depth = elements[i].getAttribute('data-depth');
		let y_offset = offset * depth;

		// if(elements[i].getAttribute('id') == 'trees-front') {
		// 	y_offset = y_offset + 5;
		// }
		$(elements[i]).css('transform', `translate(-50%, ${y_offset}px)`);
	}
}

$('#background').ready(function() {
	updateHeaderHeight();
});

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