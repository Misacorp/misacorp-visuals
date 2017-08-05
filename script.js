$(document).on('click', '.scroll-down', function() {
    $('html, body').animate({
        scrollTop: $('article').offset().top
    }, 1000);
});

$(document).ready(function() {
	window.sr = ScrollReveal();
	sr.reveal('.sr');
});