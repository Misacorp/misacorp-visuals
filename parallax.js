$(window).on('scroll', function(e) {
	update(window.pageYOffset);
});

$(window).on('resize', function(e) {
	updateHeaderHeight();
});

function update(offset) {
	let elements = $('body').find('.parallax-component');
	//	TODO this in percentage instead of pixels, if even necessary.
	//	Get element's x offset. All elements are centered similarly so we don't need to loop this.
	// let x_offset = $(elements[1]).css('transform');
	// x_offset = x_offset.split(',')[4];

	for(let i = 0; i < elements.length; i++) {
		let depth = elements[i].getAttribute('data-depth');
		let y_offset = offset * depth;

		if(elements[i].getAttribute('id') == 'trees-front') {
			y_offset = y_offset + 5;
		}
		$(elements[i]).css('transform', `translate(-50%, ${y_offset}px)`);
	}
}

$('#background').ready(function() {
	updateHeaderHeight();
});

//	Update header height to the background parallax layer's height
function updateHeaderHeight() {
	let aspect_x = 2560;
	let aspect_y = 1440;
	let ratio = aspect_y / aspect_x;

	//	Header height = viewport width * ratio.
	let height = Math.ceil($(window).width() * ratio);
	$('header').height(height + "px");
};