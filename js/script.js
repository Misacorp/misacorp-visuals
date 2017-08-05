 $(document).ready(function(){
      $('.parallax').parallax();
      $(".button-collapse").sideNav();
    });

// // ScrollFire
// var options = [
//     {selector: '#scroll-anchor', offset: 800, callback: function() {
//         $('#main-logo').css({
//             "top" : "40%"});
//         $('.text-1').css({
//             "opacity" : "1.0"})
//     } },
//     {selector: '#scroll-anchor', offset: 1500, callback: function() {
//         $('#main-logo').css({
//           "top" : "30%"});
//         $('.text-1').css({
//             "top" : "70%"})
//     } },
//   ];

// Materialize.scrollFire(options);

$(window).scroll(function () {

    if($(window).scrollTop() < 500) {
        $('#main-logo').css({
            "top" : "50%"});
        $('.text-1').css({
            "opacity" : "0"})
        }

    if($(window).scrollTop() >= 500 && $(window).scrollTop() < 1000) {
        $('#main-logo').css({
            "width" : "400px",
            "top" : "40%"});
        $('.text-1').css({
            "top" : "60%",
            "opacity" : "1"});
        $('.text-2').css({
            "opacity" : "0"});
    }

    if($(window).scrollTop() >= 1000 && $(window).scrollTop() < 1500) {
        $('#main-logo').css({
            "top" : "30%",
            "width" : "300px"});
        $('.text-1').css({
            "top" : "50%"});
        $('.text-2').css({
            "top" : "60%",
            "opacity" : "1"});
    }

    if($(window).scrollTop() >= 1500) {
        $('#main-logo').css({
            "top" : "25%",
            "width" : "200px"});
        $('.text-1').css({
            "top" : "40%"});
        $('.text-2').css({
            "top" : "50%"});
    }
});

$('#forward').click(function () {
    $(window).scrollTop($(window).scrollTop() + 500);
})