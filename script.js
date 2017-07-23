$(document).on('click', '.scroll-down', function() {
    $('html, body').animate({
        scrollTop: $('article').offset().top
    }, 1000);
});

$(document).on('scroll', function() {
    var y_scroll_pos = window.pageYOffset;
    var scroll_pos_test = $('header').height() / 2;

    if(y_scroll_pos > scroll_pos_test) {
        revealContents('#1');
    }
});

function revealContents(div_id) {
	let divs = $(div_id).find('.hidden');
	for(let i = 0; i < divs.length; i++) {
		$(divs[i]).removeClass('hidden');
	}
}