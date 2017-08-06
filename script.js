$(document).on('click', '.scroll-down', function() {
    $('html, body').animate({
        scrollTop: $('article').offset().top
    }, 1000);
});

$(document).ready(function() {
	window.sr = ScrollReveal();
	sr.reveal('.sr');
});

var animation = bodymovin.loadAnimation({
	container: document.getElementById('bm'),
	renderer: 'svg',
	loop: true,
	autoplay: true,
	path: 'img/anim/anim_test.json'

})